import { useEffect, useState } from 'react'
import { initDatabase, getSupabase } from './db'
import type { User } from 'nano-supabase'
import './App.css'

interface Task {
  id: number
  user_id: string
  title: string
  description: string | null
  completed: boolean
  priority: string
  due_date: string | null
  created_at: string
}

type AuthMode = 'signin' | 'signup'

function App() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Auth form state
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    initialize()
  }, [])

  async function initialize() {
    try {
      setLoading(true)
      const { supabase } = await initDatabase()

      // Subscribe to Supabase client's auth state changes
      supabase.auth.onAuthStateChange((event, session) => {
        setUser(session?.user as User || null)

        if (session) {
          loadTasks()
        } else {
          setTasks([])
        }
      })
    } catch (err) {
      console.error('Initialization error:', err)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadTasks() {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        setError(error.message)
        return
      }

      setTasks((data as Task[]) || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    console.log('[DEBUG] handleAuth called, mode:', authMode, 'email:', email)

    setAuthLoading(true)
    setAuthError(null)

    try {
      const supabase = getSupabase()

      if (authMode === 'signup') {
        console.log('[DEBUG] Calling supabase.auth.signUp...')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        })
        console.log('[DEBUG] SignUp result:', { data, error })
        if (error) {
          console.error('[DEBUG] SignUp error:', error)
          setAuthError(error.message)
        } else {
          console.log('[DEBUG] SignUp success!')
          setEmail('')
          setPassword('')
        }
      } else {
        console.log('[DEBUG] Calling supabase.auth.signInWithPassword...')
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        console.log('[DEBUG] SignIn result:', { data, error })
        if (error) {
          console.error('[DEBUG] SignIn error:', error)
          setAuthError(error.message)
        } else {
          console.log('[DEBUG] SignIn success!')
          setEmail('')
          setPassword('')
        }
      }
    } catch (err) {
      console.error('[DEBUG] Auth exception:', err)
      setAuthError((err as Error).message)
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleSignOut() {
    try {
      const supabase = getSupabase()
      await supabase.auth.signOut()
    } catch (err) {
      console.error('Sign out error:', err)
    }
  }

  async function addTask() {
    if (!newTaskTitle.trim() || !user) return

    const supabase = getSupabase()
    const { error } = await supabase.from('tasks').insert([{
      user_id: user.id,
      title: newTaskTitle,
      description: newTaskDescription || null,
      completed: false,
      priority: 'medium',
    }] as unknown as never).select()

    if (error) {
      setError(error.message)
      return
    }

    setNewTaskTitle('')
    setNewTaskDescription('')
    await loadTasks()
  }

  async function toggleTask(taskId: number, completed: boolean) {
    const supabase = getSupabase()
    const { error } = await supabase
      .from('tasks')
      .update({ completed: !completed } as unknown as never)
      .eq('id', taskId)

    if (error) {
      setError(error.message)
      return
    }

    await loadTasks()
  }

  async function deleteTask(taskId: number) {
    const supabase = getSupabase()
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)

    if (error) {
      setError(error.message)
      return
    }

    await loadTasks()
  }

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <h2>Initializing PGlite + Auth...</h2>
          <p>Setting up in-browser database with authentication</p>
        </div>
      </div>
    )
  }

  // Auth Screen
  if (!user) {
    return (
      <div className="app">
        <header>
          <h1>Nano Supabase Demo</h1>
          <p className="subtitle">
            Full-stack app with auth running entirely in the browser
          </p>
        </header>

        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-tabs">
              <button
                className={`auth-tab ${authMode === 'signin' ? 'active' : ''}`}
                onClick={() => { setAuthMode('signin'); setAuthError(null) }}
              >
                Sign In
              </button>
              <button
                className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => { setAuthMode('signup'); setAuthError(null) }}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={handleAuth} className="auth-form">
              <h2>{authMode === 'signin' ? 'Welcome Back' : 'Create Account'}</h2>

              {authError && (
                <div className="auth-error">{authError}</div>
              )}

              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                className="auth-submit"
                disabled={authLoading || !email || !password}
              >
                {authLoading
                  ? 'Loading...'
                  : authMode === 'signin'
                  ? 'Sign In'
                  : 'Create Account'}
              </button>
            </form>

            <div className="auth-info">
              <p>All data stored locally in your browser using PGlite</p>
              <p>Passwords hashed with pgcrypto (bcrypt)</p>
            </div>
          </div>
        </div>

        <footer>
          <p>
            Running on <strong>PGlite</strong> with <strong>Auth Emulation</strong>
          </p>
        </footer>
      </div>
    )
  }

  // Main App (Authenticated)
  return (
    <div className="app">
      <header>
        <h1>Nano Supabase Demo</h1>
        <p className="subtitle">
          Authenticated as <strong>{user.email}</strong>
        </p>
        <button className="sign-out-btn" onClick={handleSignOut}>
          Sign Out
        </button>
      </header>

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="main-container">
        <div className="main">
          <div className="add-task">
            <h2>Add New Task</h2>
            <input
              type="text"
              placeholder="Task title"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addTask()}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newTaskDescription}
              onChange={(e) => setNewTaskDescription(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addTask()}
            />
            <button onClick={addTask} disabled={!newTaskTitle.trim()}>
              Add Task
            </button>
          </div>

          <div className="tasks">
            <h2>Your Tasks ({tasks.length})</h2>
            {tasks.length === 0 ? (
              <div className="empty">No tasks yet. Add one above!</div>
            ) : (
              <div className="task-list">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`task-item ${task.completed ? 'completed' : ''}`}
                  >
                    <div className="task-checkbox">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => toggleTask(task.id, task.completed)}
                      />
                    </div>
                    <div className="task-content">
                      <div className="task-title">{task.title}</div>
                      {task.description && (
                        <div className="task-description">{task.description}</div>
                      )}
                      <div className="task-meta">
                        <span className={`priority priority-${task.priority}`}>
                          {task.priority}
                        </span>
                        <span className="task-date">
                          {new Date(task.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      className="delete-btn"
                      onClick={() => deleteTask(task.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sidebar">
          <h2>User Info</h2>
          <div className="user-info">
            <div className="info-item">
              <span className="label">Email:</span>
              <span className="value">{user.email}</span>
            </div>
            <div className="info-item">
              <span className="label">User ID:</span>
              <span className="value">{user.id.slice(0, 8)}...</span>
            </div>
            <div className="info-item">
              <span className="label">Role:</span>
              <span className="value">{user.role}</span>
            </div>
            <div className="info-item">
              <span className="label">Created:</span>
              <span className="value">
                {new Date(user.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>

          <h2>Stats</h2>
          <div className="stats">
            <div className="stat">
              <span>Total Tasks:</span>
              <strong>{tasks.length}</strong>
            </div>
            <div className="stat">
              <span>Completed:</span>
              <strong>{tasks.filter((t) => t.completed).length}</strong>
            </div>
            <div className="stat">
              <span>Pending:</span>
              <strong>{tasks.filter((t) => !t.completed).length}</strong>
            </div>
          </div>

          <div className="rls-info">
            <h3>RLS Active</h3>
            <p>
              Row Level Security ensures you only see your own tasks.
              Data is isolated per user using <code>auth.uid()</code>.
            </p>
          </div>
        </div>
      </div>

      <footer>
        <p>
          Running on <strong>PGlite</strong> with <strong>Supabase Auth Emulation</strong>
        </p>
        <p>
          All data stored in browser memory with RLS protection
        </p>
      </footer>
    </div>
  )
}

export default App
