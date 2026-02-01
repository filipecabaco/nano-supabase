import { useEffect, useState } from 'react'
import { initDatabase, getSupabase } from './db'
import './App.css'

interface User {
  id: number
  name: string
  email: string
  created_at: string
}

interface Task {
  id: number
  user_id: number
  title: string
  description: string | null
  completed: boolean
  priority: string
  due_date: string | null
  created_at: string
}

function App() {
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<User[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedUser, setSelectedUser] = useState<number | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    initialize()
  }, [])

  async function initialize() {
    try {
      setLoading(true)
      await initDatabase()
      await loadUsers()
      await loadTasks()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadUsers() {
    const supabase = getSupabase()
    const { data, error } = await supabase.from<User>('users').select('*')

    if (error) {
      setError(error.message)
      return
    }

    setUsers(data as User[])
    if (data && data.length > 0) {
      setSelectedUser((data as User[])[0]!.id)
    }
  }

  async function loadTasks() {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from<Task>('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      return
    }

    setTasks(data as Task[])
  }

  async function addTask() {
    if (!newTaskTitle.trim() || !selectedUser) return

    const supabase = getSupabase()
    const { error } = await supabase.from('tasks').insert({
      user_id: selectedUser,
      title: newTaskTitle,
      description: newTaskDescription || null,
      completed: false,
      priority: 'medium'
    })

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
      .update({ completed: !completed })
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

  const userTasks = selectedUser
    ? tasks.filter((t) => t.user_id === selectedUser)
    : []

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <h2>🚀 Initializing PGlite + Supabase...</h2>
          <p>Setting up in-browser database with schema introspection</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <h1>📋 Nano Supabase React Demo</h1>
        <p className="subtitle">
          Full-stack app running entirely in the browser with PGlite + PostgREST
        </p>
      </header>

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="container">
        <div className="sidebar">
          <h2>👥 Users</h2>
          <div className="user-list">
            {users.map((user) => (
              <div
                key={user.id}
                className={`user-item ${selectedUser === user.id ? 'active' : ''}`}
                onClick={() => setSelectedUser(user.id)}
              >
                <div className="user-name">{user.name}</div>
                <div className="user-email">{user.email}</div>
                <div className="user-tasks">
                  {tasks.filter((t) => t.user_id === user.id).length} tasks
                </div>
              </div>
            ))}
          </div>

          <div className="stats">
            <h3>📊 Statistics</h3>
            <div className="stat">
              <span>Total Users:</span>
              <strong>{users.length}</strong>
            </div>
            <div className="stat">
              <span>Total Tasks:</span>
              <strong>{tasks.length}</strong>
            </div>
            <div className="stat">
              <span>Completed:</span>
              <strong>{tasks.filter((t) => t.completed).length}</strong>
            </div>
          </div>
        </div>

        <div className="main">
          <div className="add-task">
            <h2>➕ Add New Task</h2>
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
            <h2>✅ Tasks ({userTasks.length})</h2>
            {userTasks.length === 0 ? (
              <div className="empty">No tasks yet. Add one above!</div>
            ) : (
              <div className="task-list">
                {userTasks.map((task) => (
                  <div key={task.id} className={`task-item ${task.completed ? 'completed' : ''}`}>
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
                    <button className="delete-btn" onClick={() => deleteTask(task.id)}>
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer>
        <p>
          ✨ Running on <strong>PGlite</strong> with <strong>Supabase-compatible API</strong>
        </p>
        <p>
          💾 All data stored in browser memory • 🔒 No server required • ⚡ Edge-ready
        </p>
      </footer>
    </div>
  )
}

export default App
