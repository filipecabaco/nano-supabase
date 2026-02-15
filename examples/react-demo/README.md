# nano-box

A Dropbox-style file storage app running **entirely in the browser** using [nano-supabase](https://github.com/anthropics/nano-supabase) — showcasing Auth, Data API, Storage, and Row Level Security.

## Features

- **Auth** — Sign up and sign in with email/password
- **File upload** — Drag-and-drop or file picker, stored via Supabase Storage API
- **File management** — Download and delete files with image previews
- **Row Level Security** — Each user can only see and manage their own files
- **Zero backend** — Everything runs client-side via PGlite (PostgreSQL in WebAssembly)

## Architecture

```
React + shadcn/ui
    |
Supabase Client (@supabase/supabase-js)
    |
nano-supabase (local fetch adapter)
    |
PGlite (PostgreSQL in WebAssembly)
```

## Quick Start

```bash
bun install
bun dev
```

Open http://localhost:5173

## nano-supabase APIs Used

```typescript
// Auth
supabase.auth.signUp({ email, password })
supabase.auth.signInWithPassword({ email, password })
supabase.auth.signOut()
supabase.auth.onAuthStateChange(callback)

// Data API (file metadata)
supabase.from('files').select('*').order('created_at', { ascending: false })
supabase.from('files').insert([{ name, bucket_path, size_bytes, mime_type }])
supabase.from('files').delete().eq('id', fileId)

// Storage
supabase.storage.from('user-files').upload(path, file)
supabase.storage.from('user-files').download(path)
supabase.storage.from('user-files').remove([path])
```

## RLS Policies

```sql
-- Users can only access their own file metadata
CREATE POLICY "Users can view their own files" ON public.files
  FOR SELECT USING (user_id = auth.uid());

-- Users can only access storage objects in their own folder
CREATE POLICY "Users can view their own objects" ON storage.objects
  FOR SELECT USING (bucket_id = 'user-files'
    AND (storage.foldername(name))[1] = auth.uid()::text);
```

## Tech Stack

- React + TypeScript
- Tailwind CSS v4
- shadcn/ui
- Heroicons
- PGlite
- Vite
