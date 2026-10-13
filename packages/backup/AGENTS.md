# `@solyx/backup`

What a backup is kept as, where it is kept and for how long: `./bundle` packs a folder into one file sealed under a passphrase and unpacks it again, `./s3` puts, gets, lists and deletes objects in a bucket on any server that speaks S3's API, and `./retention` says which backups have outlived their use.

## Boundaries

- No module knows what the app keeps. The host fills the folder a bundle is packed from and names the objects.
- `./retention` is a pure function over the moments backups were made: it keeps the newest few and the last of each hour, day and week, counting only periods that hold a backup, so how often backups are made never sets how many are kept, and a computer left off for months loses none to age. It deletes nothing itself.
- A bundle is a line of JSON that says how it is sealed and who made it, then a gzipped tar encrypted with AES-256-GCM under a key scrypt derives from the passphrase, then the tag over both. Its `version` changes when that layout does, and a reader refuses a version or a cost it does not know. Reading authenticates the whole file before it unpacks anything, so a wrong passphrase or a changed file writes nothing.
- The passphrase is the only way into a bundle: nothing derived from it is kept anywhere, and there is no recovery.
- `./s3` signs every request itself with AWS Signature Version 4 (`sigv4.ts`) on the key, region and endpoint its caller passes, so nothing is read from the environment or a credentials file. The bucket goes in the path, which AWS, Cloudflare R2, Backblaze B2 and MinIO all serve.
- An upload is read from the disk as it is sent and is never retried here, since a retry would go out under a signature made for an earlier moment; whoever asked makes it again.
- A failure names the server's host and the code and message the server gave.
- Tests sign against the worked examples of AWS's documentation, and reach a server only through `tests/fixtures/fake-s3.ts`, which listens on this computer and refuses a request whose signature does not hold for what arrived.
