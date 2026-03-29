import { type SupabaseClient } from "@supabase/supabase-js";
import { type PGliteWorker } from "@electric-sql/pglite/worker";
import { useCallback, useEffect, useRef, useState } from "react";
import { initDatabase } from "./db";

const TAB_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const SYNC_CHANNEL = new BroadcastChannel("pglite-workers-demo-sync");

interface Note {
	id: number;
	user_id: string;
	title: string;
	done: boolean;
	created_at: string;
}

type View = "auth" | "notes";

export default function App() {
	const [view, setView] = useState<View>("auth");
	const [isLeader, setIsLeader] = useState<boolean | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [userEmail, setUserEmail] = useState<string | null>(null);
	const [notes, setNotes] = useState<Note[]>([]);
	const [title, setTitle] = useState("");
	const [authEmail, setAuthEmail] = useState("alice@example.com");
	const [authPassword, setAuthPassword] = useState("password123");
	const [authError, setAuthError] = useState<string | null>(null);
	const [authLoading, setAuthLoading] = useState(false);
	const [fileStatus, setFileStatus] = useState<string | null>(null);

	const supabaseRef = useRef<SupabaseClient | null>(null);
	const pgRef = useRef<PGliteWorker | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const refresh = useCallback(async () => {
		if (!supabaseRef.current) return;
		const { data } = await supabaseRef.current.from("notes").select("*").order("created_at", { ascending: false });
		if (data) setNotes(data);
	}, []);

	useEffect(() => {
		let cancelled = false;
		initDatabase()
			.then(({ pg, supabase }) => {
				if (cancelled) return;
				pgRef.current = pg;
				supabaseRef.current = supabase;
				setIsLeader(pg.isLeader);
				pg.onLeaderChange(() => setIsLeader(pg.isLeader));
				setReady(true);
			})
			.catch((e) => {
				if (!cancelled) setError(String(e));
			});

		const onSync = () => refresh();
		SYNC_CHANNEL.addEventListener("message", onSync);
		return () => {
			cancelled = true;
			SYNC_CHANNEL.removeEventListener("message", onSync);
		};
	}, [refresh]);

	const notify = () => SYNC_CHANNEL.postMessage("refresh");

	const handleSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!supabaseRef.current) return;
		setAuthLoading(true);
		setAuthError(null);
		const { error } = await supabaseRef.current.auth.signUp({ email: authEmail, password: authPassword });
		if (error) {
			setAuthError(error.message);
			setAuthLoading(false);
			return;
		}
		const { error: signInError } = await supabaseRef.current.auth.signInWithPassword({ email: authEmail, password: authPassword });
		setAuthLoading(false);
		if (signInError) {
			setAuthError(signInError.message);
			return;
		}
		setUserEmail(authEmail);
		setView("notes");
		await refresh();
	};

	const handleSignIn = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!supabaseRef.current) return;
		setAuthLoading(true);
		setAuthError(null);
		const { error } = await supabaseRef.current.auth.signInWithPassword({ email: authEmail, password: authPassword });
		setAuthLoading(false);
		if (error) {
			setAuthError(error.message);
			return;
		}
		setUserEmail(authEmail);
		setView("notes");
		await refresh();
	};

	const handleSignOut = async () => {
		if (!supabaseRef.current) return;
		await supabaseRef.current.auth.signOut();
		setUserEmail(null);
		setNotes([]);
		setView("auth");
	};

	const handleAddNote = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!supabaseRef.current || !title.trim()) return;
		setTitle("");
		await supabaseRef.current.from("notes").insert({ title: title.trim() });
		await refresh();
		notify();
		inputRef.current?.focus();
	};

	const handleToggle = async (note: Note) => {
		if (!supabaseRef.current) return;
		await supabaseRef.current.from("notes").update({ done: !note.done }).eq("id", note.id);
		await refresh();
		notify();
	};

	const handleDelete = async (id: number) => {
		if (!supabaseRef.current) return;
		await supabaseRef.current.from("notes").delete().eq("id", id);
		await refresh();
		notify();
	};

	const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!supabaseRef.current || !e.target.files?.[0]) return;
		const file = e.target.files[0];
		setFileStatus(`Uploading ${file.name}...`);
		const path = `${Date.now()}-${file.name}`;
		const { error } = await supabaseRef.current.storage.from("attachments").upload(path, file);
		if (error) {
			setFileStatus(`Upload failed: ${error.message}`);
		} else {
			setFileStatus(`Uploaded "${file.name}" to attachments/${path}`);
		}
		e.target.value = "";
		setTimeout(() => setFileStatus(null), 4000);
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

	const doneCount = notes.filter((n) => n.done).length;

	return (
		<div className="container">
			<header className="header">
				<div className="title-row">
					<h1>PGlite Workers + Supabase</h1>
					<div className="badges">
						<span className="badge tab-badge">Tab {TAB_ID}</span>
						<span className={`badge ${isLeader ? "leader-badge" : "follower-badge"}`}>
							{isLeader ? "Leader" : "Follower"}
						</span>
						{userEmail && <span className="badge user-badge">{userEmail}</span>}
					</div>
				</div>
				<p className="description">
					Full Supabase stack (auth, RLS, storage) running through a PGlite Web Worker.
					{isLeader
						? " This tab is the leader — it runs Postgres."
						: " This tab proxies to the leader via BroadcastChannel."}
				</p>
			</header>

			<div className="info-cards">
				<div className="info-card">
					<div className="info-label">What's happening</div>
					<div className="info-value">
						<strong>PGliteWorker</strong> runs Postgres in a Web Worker. nano-supabase's{" "}
						<strong>createFetchAdapter</strong> wires auth, PostgREST, and storage to it —
						so <code>supabase-js</code> works exactly like with a real Supabase backend.
						RLS policies enforce per-user data isolation.
					</div>
				</div>
				<div className="info-card">
					<div className="info-label">Try it</div>
					<div className="info-value">
						Sign up as <strong>alice@example.com</strong>, add notes.
						Open a second tab, sign up as <strong>bob@example.com</strong> — each user only sees their own notes (RLS).
						Close the leader tab — the follower takes over seamlessly.
					</div>
				</div>
			</div>

			{view === "auth" ? (
				<div className="auth-section">
					<form className="auth-form" onSubmit={handleSignIn}>
						<input
							className="input"
							type="email"
							placeholder="Email"
							value={authEmail}
							onChange={(e) => setAuthEmail(e.target.value)}
						/>
						<input
							className="input"
							type="password"
							placeholder="Password"
							value={authPassword}
							onChange={(e) => setAuthPassword(e.target.value)}
						/>
						{authError && <div className="auth-error">{authError}</div>}
						<div className="auth-buttons">
							<button className="btn btn-primary" type="submit" disabled={authLoading}>
								Sign In
							</button>
							<button className="btn btn-secondary" type="button" disabled={authLoading} onClick={handleSignUp}>
								Sign Up
							</button>
						</div>
					</form>
				</div>
			) : (
				<>
					<div className="notes-header">
						<div className="stats">
							{notes.length} note{notes.length !== 1 && "s"} &middot; {doneCount} done &middot;{" "}
							{notes.length - doneCount} remaining
						</div>
						<button className="btn btn-secondary btn-sm" onClick={handleSignOut}>
							Sign Out
						</button>
					</div>

					<form className="add-form" onSubmit={handleAddNote}>
						<input
							ref={inputRef}
							className="input"
							type="text"
							placeholder="Add a note..."
							value={title}
							onChange={(e) => setTitle(e.target.value)}
						/>
						<button className="btn btn-primary" type="submit" disabled={!title.trim()}>
							Add
						</button>
					</form>

					<ul className="todo-list">
						{notes.length === 0 && (
							<li className="empty-state">No notes yet. Add one above!</li>
						)}
						{notes.map((note) => (
							<li key={note.id} className={`todo-item ${note.done ? "done" : ""}`}>
								<label className="todo-label">
									<input
										type="checkbox"
										checked={note.done}
										onChange={() => handleToggle(note)}
										className="checkbox"
									/>
									<span className="todo-title">{note.title}</span>
								</label>
								<button className="btn btn-delete" onClick={() => handleDelete(note.id)} title="Delete">
									&times;
								</button>
							</li>
						))}
					</ul>

					<div className="storage-section">
						<div className="info-label">Storage</div>
						<label className="file-upload">
							<span className="btn btn-secondary btn-sm">Upload File</span>
							<input type="file" onChange={handleFileUpload} style={{ display: "none" }} />
						</label>
						{fileStatus && <div className="file-status">{fileStatus}</div>}
					</div>
				</>
			)}

			<footer className="footer">
				<p>
					<strong>@electric-sql/pglite/worker</strong> + <strong>nano-supabase</strong> createFetchAdapter
				</p>
				<p>
					Auth + RLS + Storage &middot; IndexedDB (<code>idb://pglite-workers-demo</code>)
				</p>
			</footer>
		</div>
	);
}
