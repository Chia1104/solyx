# `@solyx/backup`

What a backup is kept as and where it is kept: `./bundle` packs a folder into one file sealed under a passphrase and unpacks it again, and `./s3` puts, gets and lists objects in a bucket on any server that speaks S3's API.

## Boundaries

- Neither module knows what the app keeps. The host fills the folder a bundle is packed from, names the objects and decides which to keep.
- A bundle is a line of JSON that says how it is sealed and who made it, then a gzipped tar encrypted with AES-256-GCM under a key scrypt derives from the passphrase, then the tag over both. Its `version` changes when that layout does, and a reader refuses a version or a cost it does not know. Reading authenticates the whole file before it unpacks anything, so a wrong passphrase or a changed file writes nothing. A bundle holds a folder's files and folders and no link, which would not unpack as it was once it points outside the folder, and unpacking fails whole when any of them cannot be written.
- The passphrase is the only way into a bundle: nothing derived from it is kept anywhere, and there is no recovery.
- `./s3` signs every request itself with AWS Signature Version 4 (`sigv4.ts`) on the key, region and endpoint its caller passes, so nothing is read from the environment or a credentials file. The bucket goes in the path, which AWS, Cloudflare R2, Backblaze B2 and MinIO all serve.
- An upload is read from the disk as it is sent and is never retried here, since a retry would go out under a signature made for an earlier moment; whoever asked makes it again.
- A failure names the server's host and the code and message the server gave.
- Tests sign against the worked examples of AWS's documentation, and reach a server only through `tests/fixtures/fake-s3.ts`, which listens on this computer and refuses a request whose signature does not hold for what arrived.
