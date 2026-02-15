import { useEffect, useState, useRef, useCallback } from 'react'
import { initDatabase, getSupabase } from './db'
import type { User } from 'nano-supabase'
import {
  CloudArrowUpIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  FolderOpenIcon,
  PhotoIcon,
  FilmIcon,
  MusicalNoteIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  CodeBracketIcon,
  PaperClipIcon,
  ArrowRightStartOnRectangleIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import './App.css'

interface FileRecord {
  id: number
  user_id: string
  name: string
  bucket_path: string
  size_bytes: number
  mime_type: string
  created_at: string
}

type AuthMode = 'signin' | 'signup'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const cls = "w-5 h-5 text-muted-foreground"
  if (mimeType.startsWith('image/')) return <PhotoIcon className={cls} />
  if (mimeType.startsWith('video/')) return <FilmIcon className={cls} />
  if (mimeType.startsWith('audio/')) return <MusicalNoteIcon className={cls} />
  if (mimeType === 'application/pdf') return <DocumentTextIcon className={cls} />
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return <ArchiveBoxIcon className={cls} />
  if (mimeType.includes('text/') || mimeType.includes('json') || mimeType.includes('javascript')) return <CodeBracketIcon className={cls} />
  return <PaperClipIcon className={cls} />
}

function NanoBoxLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 4L4 18V46L32 60L60 46V18L32 4Z" fill="url(#box_grad)" stroke="#249361" strokeWidth="1.5" />
      <path d="M4 18L32 32L60 18" stroke="#3ECF8E" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 32V60" stroke="#3ECF8E" strokeWidth="2" />
      <path d="M32 4L4 18L32 32L60 18L32 4Z" fill="#3ECF8E" fillOpacity="0.25" />
      <path d="M18 11L46 25" stroke="#3ECF8E" strokeWidth="1" strokeOpacity="0.4" />
      <circle cx="32" cy="32" r="4" fill="#3ECF8E" />
      <defs>
        <linearGradient id="box_grad" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C1C1C" />
          <stop offset="1" stopColor="#249361" stopOpacity="0.3" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [files, setFiles] = useState<FileRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function initialize() {
    try {
      setLoading(true)
      const { supabase } = await initDatabase()
      supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user as User || null)
        if (session) {
          loadFiles()
        } else {
          setFiles([])
        }
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadFiles() {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      return
    }
    setFiles((data as FileRecord[]) || [])
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError(null)

    try {
      const supabase = getSupabase()
      const { error } = authMode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        setAuthError(error.message)
      } else {
        setEmail('')
        setPassword('')
      }
    } catch (err) {
      setAuthError((err as Error).message)
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleSignOut() {
    const supabase = getSupabase()
    await supabase.auth.signOut()
  }

  const uploadFiles = useCallback(async (fileList: FileList | File[]) => {
    if (!user || fileList.length === 0) return
    setUploading(true)
    setError(null)

    const supabase = getSupabase()

    for (const file of Array.from(fileList)) {
      const bucketPath = `${user.id}/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('user-files')
        .upload(bucketPath, file, { contentType: file.type || 'application/octet-stream' })

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`)
        continue
      }

      const { error: insertError } = await supabase.from('files').insert([{
        user_id: user.id,
        name: file.name,
        bucket_path: bucketPath,
        size_bytes: file.size,
        mime_type: file.type || 'application/octet-stream',
      }] as unknown as never)

      if (insertError) {
        setError(`Metadata insert failed: ${insertError.message}`)
      }
    }

    await loadFiles()
    setUploading(false)
  }, [user])

  async function downloadFile(fileRecord: FileRecord) {
    const supabase = getSupabase()
    const { data, error } = await supabase.storage
      .from('user-files')
      .download(fileRecord.bucket_path)

    if (error || !data) {
      setError(`Download failed: ${error?.message || 'No data'}`)
      return
    }

    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = fileRecord.name
    a.click()
    URL.revokeObjectURL(url)
  }

  async function deleteFile(fileRecord: FileRecord) {
    const supabase = getSupabase()

    const { error: storageError } = await supabase.storage
      .from('user-files')
      .remove([fileRecord.bucket_path])

    if (storageError) {
      setError(`Storage delete failed: ${storageError.message}`)
      return
    }

    const { error: dbError } = await supabase
      .from('files')
      .delete()
      .eq('id', fileRecord.id)

    if (dbError) {
      setError(`Metadata delete failed: ${dbError.message}`)
      return
    }

    await loadFiles()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files)
    }
  }

  const [previews, setPreviews] = useState<Record<number, string>>({})

  const loadPreview = useCallback(async (file: FileRecord) => {
    if (previews[file.id] || !file.mime_type.startsWith('image/')) return
    const supabase = getSupabase()
    const { data } = await supabase.storage
      .from('user-files')
      .download(file.bucket_path)
    if (data) {
      const url = URL.createObjectURL(data)
      setPreviews(prev => ({ ...prev, [file.id]: url }))
    }
  }, [previews])

  useEffect(() => {
    files.forEach(f => { if (f.mime_type.startsWith('image/')) loadPreview(f) })
  }, [files, loadPreview])

  const totalSize = files.reduce((acc, f) => acc + f.size_bytes, 0)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <div className="flex items-center justify-center gap-3 mb-3">
                <NanoBoxLogo size={36} />
                <h1 className="text-2xl font-bold">nano-box</h1>
              </div>
              <p className="text-muted-foreground text-sm">Your files, in the browser</p>
            </div>

            <Card>
              <CardContent className="pt-6">
                <div className="flex mb-6 border-b border-border">
                  <button
                    className={`flex-1 pb-3 text-sm font-medium transition-colors ${authMode === 'signin' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => { setAuthMode('signin'); setAuthError(null) }}
                  >
                    Sign In
                  </button>
                  <button
                    className={`flex-1 pb-3 text-sm font-medium transition-colors ${authMode === 'signup' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => { setAuthMode('signup'); setAuthError(null) }}
                  >
                    Sign Up
                  </button>
                </div>

                {authError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>{authError}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleAuth} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={authLoading || !email || !password}
                  >
                    {authLoading ? 'Loading...' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <NanoBoxLogo />
          <span className="text-lg font-semibold">nano-box</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <span className="text-xs text-muted-foreground/60">{files.length} files · {formatBytes(totalSize)}</span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <ArrowRightStartOnRectangleIcon className="w-4 h-4 mr-1.5" />
            Sign Out
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4">
          <Alert variant="destructive">
            <AlertDescription className="flex justify-between items-center">
              <span>{error}</span>
              <Button variant="ghost" size="sm" onClick={() => setError(null)} className="text-xs">Dismiss</Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <main className="flex-1 p-6">
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center mb-6 transition-colors cursor-pointer ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          <CloudArrowUpIcon className={`w-12 h-12 mx-auto mb-3 ${uploading ? 'text-primary animate-pulse' : 'text-muted-foreground'}`} />
          <p className="text-sm font-medium">
            {uploading ? 'Uploading...' : 'Drop files here or click to browse'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Max 10 MB per file</p>
        </div>

        {files.length === 0 ? (
          <div className="text-center py-16">
            <FolderOpenIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm">No files yet. Upload something to get started.</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="flex items-center gap-3">
                      {previews[file.id] ? (
                        <img src={previews[file.id]} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      ) : (
                        <FileIcon mimeType={file.mime_type} />
                      )}
                      <span className="truncate max-w-xs">{file.name}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatBytes(file.size_bytes)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{file.mime_type.split('/')[1] || file.mime_type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{new Date(file.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => downloadFile(file)}
                          title="Download"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                        >
                          <ArrowDownTrayIcon className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteFile(file)}
                          title="Delete"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </main>
    </div>
  )
}

export default App
