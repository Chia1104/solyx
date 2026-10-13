import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import { Stats, createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { create, extract } from "tar";
import * as z from "zod";

const FORMAT = "solyx-backup";

/** The extension a bundle's file takes. */
export const BUNDLE_EXTENSION = ".solyx-backup";

const CIPHER = "aes-256-gcm";

const KEY_BYTES = 32;

const SALT_BYTES = 16;

const NONCE_BYTES = 12;

const TAG_BYTES = 16;

// scrypt as OWASP sets it for a password kept offline: each guess costs 128 MiB and a good part
// of a second, since whoever holds a bundle may try passphrases against it without limit.
const KDF = { name: "scrypt", cost: 2 ** 17, blockSize: 8, parallelism: 1 };

const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

// A header is a line of JSON a few hundred bytes long; anything longer is not a bundle.
const HEADER_LIMIT = 4096;

/** Who made a bundle and when. */
export const bundleOriginSchema = z.object({
  /** The app's name, which differs by channel. */
  app: z.string().min(1),
  version: z.string().min(1),
  installation: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

export type BundleOrigin = z.infer<typeof bundleOriginSchema>;

const headerSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(1),
  origin: bundleOriginSchema,
  kdf: z.object({
    name: z.literal(KDF.name),
    // No more than this build writes, so a changed header cannot ask for all the memory there is.
    cost: z.number().int().positive().max(KDF.cost),
    blockSize: z.number().int().positive().max(KDF.blockSize),
    parallelism: z.number().int().positive().max(KDF.parallelism),
    salt: z.base64(),
  }),
  cipher: z.literal(CIPHER),
  nonce: z.base64(),
});

type Header = z.infer<typeof headerSchema>;

const derive = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);

// Normalized, so a passphrase typed on another keyboard or system gives the same key.
const keyOf = (passphrase: string, { kdf }: Header) =>
  derive(
    passphrase.normalize("NFKC"),
    Buffer.from(kdf.salt, "base64"),
    KEY_BYTES,
    {
      N: kdf.cost,
      r: kdf.blockSize,
      p: kdf.parallelism,
      maxmem: SCRYPT_MAX_MEMORY,
    }
  );

export interface WriteBundleOptions {
  /** The folder whose whole content the bundle holds. */
  folder: string;
  /** Where the bundle is written, over whatever is there. */
  file: string;
  passphrase: string;
  origin: BundleOrigin;
}

/**
 * Packs a folder into one file sealed under a passphrase: a line of JSON that says how it is
 * sealed, then the folder as a gzipped tar encrypted with AES-256-GCM, then the tag that
 * authenticates both. Without the passphrase nothing but that first line can be read. Only the
 * folder's files and folders are packed: a link is left out, since unpacking refuses one that
 * points outside the folder.
 */
export async function writeBundle({
  folder,
  file,
  passphrase,
  origin,
}: WriteBundleOptions): Promise<void> {
  const header: Header = {
    format: FORMAT,
    version: 1,
    origin,
    kdf: { ...KDF, salt: randomBytes(SALT_BYTES).toString("base64") },
    cipher: CIPHER,
    nonce: randomBytes(NONCE_BYTES).toString("base64"),
  };

  const line = Buffer.from(`${JSON.stringify(header)}\n`);

  const cipher = createCipheriv(
    CIPHER,
    await keyOf(passphrase, header),
    Buffer.from(header.nonce, "base64")
  );

  cipher.setAAD(line);

  await pipeline(
    create(
      {
        cwd: folder,
        gzip: true,
        portable: true,
        filter: (_, entry) =>
          entry instanceof Stats && (entry.isFile() || entry.isDirectory()),
      },
      await readdir(folder)
    ),
    cipher,
    async function* (sealed: AsyncIterable<Buffer>) {
      yield line;
      yield* sealed;
      yield cipher.getAuthTag();
    },
    createWriteStream(file, { mode: 0o600 })
  );
}

function parseHeader(text: string): Header | undefined {
  try {
    return headerSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export interface ReadBundleOptions {
  file: string;
  /** The folder the bundle's content is unpacked into, made when it is not there. */
  folder: string;
  passphrase: string;
}

/**
 * Unpacks what `writeBundle` packed and says who made it. The whole file is authenticated before
 * anything is unpacked, so a wrong passphrase or a file that was changed writes nothing, and a
 * file or folder that cannot be written fails the whole of it.
 */
export async function readBundle({
  file,
  folder,
  passphrase,
}: ReadBundleOptions): Promise<BundleOrigin> {
  const handle = await open(file);

  let header: Header | undefined;
  let line: Buffer;
  let bytes: number;

  const tag = Buffer.alloc(TAG_BYTES);

  try {
    bytes = (await handle.stat()).size;

    const start = Buffer.alloc(Math.min(bytes, HEADER_LIMIT));

    await handle.read(start, 0, start.length, 0);

    const end = start.indexOf("\n");

    line = start.subarray(0, end + 1);
    header = end === -1 ? undefined : parseHeader(line.toString("utf8"));

    // A tar is never empty, so neither is what lies between the header and the tag.
    if (!header || bytes <= line.length + TAG_BYTES) {
      throw new Error("This file is not a Solyx backup");
    }

    await handle.read(tag, 0, TAG_BYTES, bytes - TAG_BYTES);
  } finally {
    await handle.close();
  }

  const key = await keyOf(passphrase, header);
  const nonce = Buffer.from(header.nonce, "base64");

  const sealed = () =>
    createReadStream(file, { start: line.length, end: bytes - TAG_BYTES - 1 });

  const decipher = () =>
    createDecipheriv(CIPHER, key, nonce).setAAD(line).setAuthTag(tag);

  const authenticating = decipher();

  for await (const chunk of sealed().iterator()) authenticating.update(chunk);

  try {
    authenticating.final();
  } catch {
    throw new Error(
      "The passphrase does not open this backup, or the file was changed"
    );
  }

  await mkdir(folder, { recursive: true });
  // tar only warns of what it could not write and goes on to the rest, so the first warning is
  // kept and thrown once it has stopped writing, when whoever asked may clear the folder away.
  let failed: Error | undefined;

  await pipeline(
    sealed(),
    decipher(),
    extract({
      cwd: folder,
      onwarn(_, message, data) {
        failed ??= data instanceof Error ? data : new Error(message);
      },
    })
  );

  if (failed) throw failed;

  return header.origin;
}
