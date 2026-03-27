# Storage

Demonstrates the Supabase-compatible storage API — bucket management, file upload/download, signed URLs, and file operations. Everything runs in-process with a pluggable storage backend.

## What it shows

- Creating public and private buckets with size/MIME type limits
- Uploading files (text, CSV, images)
- Listing files in directories
- Downloading file content
- Public URLs for public buckets
- Signed URLs with expiry for private buckets
- Moving, copying, and deleting files

## Run

```bash
pnpm run example:storage
```

## Key APIs

- `supabase.storage.listBuckets()` — list all buckets
- `supabase.storage.from(bucket).upload(path, data, opts)` — upload a file
- `supabase.storage.from(bucket).download(path)` — download a file
- `supabase.storage.from(bucket).list(prefix)` — list files
- `supabase.storage.from(bucket).getPublicUrl(path)` — public URL (public buckets)
- `supabase.storage.from(bucket).createSignedUrl(path, expiry)` — signed URL (private buckets)
- `supabase.storage.from(bucket).move(from, to)` — move a file
- `supabase.storage.from(bucket).copy(from, to)` — copy a file
- `supabase.storage.from(bucket).remove([paths])` — delete files
