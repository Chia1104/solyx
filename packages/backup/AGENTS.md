# `@solyx/backup`

What a backup is kept as, where and for how long: `./bundle` seals a folder into one file under a passphrase and opens it again, `./s3` keeps objects on any server that speaks S3's API, and `./retention` says which backups have outlived their use.

## Boundaries

- No module knows what the app keeps. The host fills the folder a bundle is packed from and names the objects.
- `./retention` is pure and deletes nothing. It counts only periods that hold a backup, so how often backups are made never sets how many are kept, and a computer left off for months loses none to age.
- A bundle's `version` changes when its layout does, and a reader refuses a version or a scrypt cost it does not know. Reading authenticates the whole file before it unpacks anything, so a wrong passphrase or a changed file writes nothing. A bundle holds no link, which would not unpack as it was once it points outside the folder, and unpacking fails whole when any entry cannot be written.
- The passphrase is the only way into a bundle: nothing derived from it is kept anywhere, and there is no recovery.
- `./s3` signs every request itself with AWS Signature Version 4 on the key, region and endpoint its caller passes, so nothing is read from the environment or a credentials file. The bucket goes in the path, which AWS, Cloudflare R2, Backblaze B2 and MinIO all serve. A key with a `.` or `..` segment is refused before any request, since a URL resolves one, encoded or not, to another object.
- An upload is read from the disk as it is sent and is never retried here, since a retry would go out under a signature made for an earlier moment; whoever asked makes it again.
- Tests sign against the worked examples of AWS's documentation, and reach a server only through `tests/fixtures/fake-s3.ts`, which refuses a request whose signature does not hold for what arrived.
