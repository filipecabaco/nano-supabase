import { useCallback, useEffect, useRef, useState } from "react";
import { type Todo, addTodo, deleteTodo, getDb, listTodos, toggleTodo } from "./db";

const TAB_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

const SYNC_CHANNEL = new BroadcastChannel("pglite-workers-demo-sync");

export default function App() {
	const [todos, setTodos] = useState<Todo[]>([]);
	const [title, setTitle] = useState("");
	const [isLeader, setIsLeader] = useState<boolean | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const refresh = useCallback(async () => {
		try {
			const rows = await listTodos();
			setTodos(rows);
		} catch (e) {
			console.error("refresh error", e);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;

		getDb()
			.then(async (db) => {
				if (cancelled) return;

				setIsLeader(db.isLeader);
				db.onLeaderChange((leader: boolean) => setIsLeader(leader));

				await refresh();
				setReady(true);
			})
			.catch((e) => {
				if (!cancelled) setError(String(e));
			});

		const onSync = () => {
			refresh();
		};
		SYNC_CHANNEL.addEventListener("message", onSync);

		return () => {
			cancelled = true;
			SYNC_CHANNEL.removeEventListener("message", onSync);
		};
	}, [refresh]);

	const notifyOtherTabs = () => {
		SYNC_CHANNEL.postMessage("refresh");
	};

	const handleAdd = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = title.trim();
		if (!trimmed) return;
		setTitle("");
		await addTodo(trimmed);
		await refresh();
		notifyOtherTabs();
		inputRef.current?.focus();
	};

	const handleToggle = async (todo: Todo) => {
		await toggleTodo(todo.id, !todo.done);
		await refresh();
		notifyOtherTabs();
	};

	const handleDelete = async (id: number) => {
		await deleteTodo(id);
		await refresh();
		notifyOtherTabs();
	};

	if (error) {
		return (
			<div style={{ padding: 40, fontFamily: "Inter, sans-serif" }}>
				<h1 style={{ color: "#ef4444" }}>Failed to initialize</h1>
				<pre style={{ color: "#888", whiteSpace: "pre-wrap" }}>{error}</pre>
			</div>
		);
	}

	if (!ready) {
		return (
			<div className="container">
				<div className="loading">
					<div className="spinner" />
					<p>Starting PGlite Worker...</p>
					<p className="subtitle">Electing leader across tabs</p>
				</div>
			</div>
		);
	}

	const doneCount = todos.filter((t) => t.done).length;

	return (
		<div className="container">
			<header className="header">
				<div className="title-row">
					<h1>PGlite Workers Demo</h1>
					<div className="badges">
						<span className="badge tab-badge">Tab {TAB_ID}</span>
						<span className={`badge ${isLeader ? "leader-badge" : "follower-badge"}`}>
							{isLeader ? "Leader" : "Follower"}
						</span>
					</div>
				</div>
				<p className="description">
					{isLeader
						? "This tab is the elected leader — it runs the PGlite instance. Other tabs proxy queries here."
						: "This tab proxies queries to the leader tab via BroadcastChannel. If the leader closes, this tab may become the new leader."}
				</p>
			</header>

			<div className="info-cards">
				<div className="info-card">
					<div className="info-label">Architecture</div>
					<div className="info-value">
						PGlite runs inside a <strong>Web Worker</strong> — the main thread stays responsive.
						Across multiple tabs, <strong>navigator.locks</strong> elects one leader.
						Only the leader instantiates Postgres. Followers proxy via BroadcastChannel.
					</div>
				</div>
				<div className="info-card">
					<div className="info-label">Try it</div>
					<div className="info-value">
						Open this page in <strong>multiple tabs</strong>. Add todos in any tab — they appear
						everywhere. Close the leader tab — a follower gets promoted automatically.
					</div>
				</div>
			</div>

			<form className="add-form" onSubmit={handleAdd}>
				<input
					ref={inputRef}
					className="input"
					type="text"
					placeholder="What needs to be done?"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
				/>
				<button className="btn btn-primary" type="submit" disabled={!title.trim()}>
					Add
				</button>
			</form>

			{todos.length > 0 && (
				<div className="stats">
					{todos.length} todo{todos.length !== 1 && "s"} &middot; {doneCount} done &middot;{" "}
					{todos.length - doneCount} remaining
				</div>
			)}

			<ul className="todo-list">
				{todos.length === 0 && (
					<li className="empty-state">No todos yet. Add one above!</li>
				)}
				{todos.map((todo) => (
					<li key={todo.id} className={`todo-item ${todo.done ? "done" : ""}`}>
						<label className="todo-label">
							<input
								type="checkbox"
								checked={todo.done}
								onChange={() => handleToggle(todo)}
								className="checkbox"
							/>
							<span className="todo-title">{todo.title}</span>
						</label>
						<button
							className="btn btn-delete"
							onClick={() => handleDelete(todo.id)}
							title="Delete"
						>
							&times;
						</button>
					</li>
				))}
			</ul>

			<footer className="footer">
				<p>
					Powered by{" "}
					<strong>@electric-sql/pglite/worker</strong> + <strong>nano-supabase</strong>
				</p>
				<p>
					Data persisted in IndexedDB (<code>idb://pglite-workers-demo</code>)
				</p>
			</footer>
		</div>
	);
}
