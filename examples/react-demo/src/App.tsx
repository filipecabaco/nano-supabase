import { useEffect, useState, useRef, useCallback } from 'react'
import { initDatabase, getSupabase } from './db'
import type { User } from 'nano-supabase'
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

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
  if (mimeType.includes('text/') || mimeType.includes('json') || mimeType.includes('javascript')) return '📝'
  return '📎'
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

  const totalSize = files.reduce((acc, f) => acc + f.size_bytes, 0)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Initializing PGlite + nano-supabase...</p>
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
                <h1 className="text-2xl font-bold text-white">nano-box</h1>
              </div>
              <p className="text-gray-500 text-sm">File storage running entirely in your browser</p>
            </div>

            <div className="bg-surface rounded-lg border border-surface-border p-6">
              <div className="flex mb-6 border-b border-surface-border">
                <button
                  className={`flex-1 pb-3 text-sm font-medium transition-colors ${authMode === 'signin' ? 'text-brand border-b-2 border-brand' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => { setAuthMode('signin'); setAuthError(null) }}
                >
                  Sign In
                </button>
                <button
                  className={`flex-1 pb-3 text-sm font-medium transition-colors ${authMode === 'signup' ? 'text-brand border-b-2 border-brand' : 'text-gray-500 hover:text-gray-300'}`}
                  onClick={() => { setAuthMode('signup'); setAuthError(null) }}
                >
                  Sign Up
                </button>
              </div>

              {authError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-md p-3 mb-4">
                  {authError}
                </div>
              )}

              <form onSubmit={handleAuth} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-[#171717] border border-surface-border rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1.5">Password</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-3 py-2 bg-[#171717] border border-surface-border rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading || !email || !password}
                  className="w-full py-2.5 bg-brand hover:bg-brand-dark text-black font-medium rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {authLoading ? 'Loading...' : authMode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              </form>

              <div className="mt-6 pt-4 border-t border-surface-border text-center space-y-1">
                <p className="text-xs text-gray-600">All data stored locally via PGlite</p>
                <p className="text-xs text-gray-600">Auth, Storage, Data API &amp; RLS — zero network calls</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-surface-border bg-surface px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <NanoBoxLogo />
          <span className="text-lg font-semibold text-white">nano-box</span>
          <span className="text-xs bg-brand/10 text-brand px-2 py-0.5 rounded-full font-medium">powered by nano-supabase</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{user.email}</span>
          <button
            onClick={handleSignOut}
            className="px-3 py-1.5 text-sm border border-surface-border rounded-md text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-md p-3 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-4 text-xs">Dismiss</button>
        </div>
      )}

      <div className="flex-1 flex">
        {/* Main Content */}
        <main className="flex-1 p-6">
          {/* Upload Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center mb-6 transition-colors cursor-pointer ${
              dragOver
                ? 'border-brand bg-brand/5'
                : 'border-surface-border hover:border-gray-500'
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
            <div className="text-4xl mb-3">{uploading ? '⏳' : '☁️'}</div>
            <p className="text-sm text-gray-300 font-medium">
              {uploading ? 'Uploading...' : 'Drop files here or click to browse'}
            </p>
            <p className="text-xs text-gray-600 mt-1">Max 10 MB per file</p>
          </div>

          {/* File List */}
          {files.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">📂</div>
              <p className="text-gray-500 text-sm">No files yet. Upload something to get started.</p>
            </div>
          ) : (
            <div className="bg-surface rounded-lg border border-surface-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left text-gray-500">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Size</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Uploaded</th>
                    <th className="px-4 py-3 font-medium w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={file.id} className="border-b border-surface-border last:border-0 hover:bg-surface-light transition-colors">
                      <td className="px-4 py-3 flex items-center gap-2">
                        <span>{fileIcon(file.mime_type)}</span>
                        <span className="text-white truncate max-w-xs">{file.name}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{formatBytes(file.size_bytes)}</td>
                      <td className="px-4 py-3">
                        <span className="bg-surface-light text-gray-400 text-xs px-2 py-0.5 rounded">{file.mime_type.split('/')[1] || file.mime_type}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{new Date(file.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => downloadFile(file)}
                            className="p-1.5 rounded hover:bg-brand/10 text-gray-400 hover:text-brand transition-colors"
                            title="Download"
                          >
                            ⬇️
                          </button>
                          <button
                            onClick={() => deleteFile(file)}
                            className="p-1.5 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside className="w-72 border-l border-surface-border bg-surface p-5 space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">User</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Email</span>
                <span className="text-gray-300 truncate ml-2">{user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">ID</span>
                <span className="text-gray-300 font-mono text-xs">{user.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Role</span>
                <span className="text-brand text-xs font-medium">{user.role}</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Storage</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Files</span>
                <span className="text-white font-medium">{files.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Size</span>
                <span className="text-white font-medium">{formatBytes(totalSize)}</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Showcased APIs</h3>
            <div className="space-y-2">
              {[
                ['Auth', 'Sign up, sign in, sessions'],
                ['Data API', 'PostgREST-compatible queries'],
                ['Storage', 'Upload, download, delete'],
                ['RLS', 'Per-user row isolation'],
              ].map(([title, desc]) => (
                <div key={title} className="flex items-start gap-2">
                  <span className="text-brand mt-0.5 text-xs">●</span>
                  <div>
                    <div className="text-xs font-medium text-gray-300">{title}</div>
                    <div className="text-xs text-gray-600">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-brand/5 border border-brand/20 rounded-md p-3">
            <div className="text-xs font-medium text-brand mb-1">RLS Active</div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Row Level Security ensures you only see your own files. Both the <code className="bg-surface-light px-1 rounded text-gray-400">files</code> table and <code className="bg-surface-light px-1 rounded text-gray-400">storage.objects</code> are protected via <code className="bg-surface-light px-1 rounded text-gray-400">auth.uid()</code>.
            </p>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="border-t border-surface-border px-6 py-3 text-center">
        <p className="text-xs text-gray-600">
          <span className="text-brand font-medium">nano-box</span> — powered by nano-supabase (PGlite + Auth + Storage + PostgREST in the browser)
        </p>
      </footer>
    </div>
  )
}

export default App
