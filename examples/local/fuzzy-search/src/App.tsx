import { type PGliteWorker } from "@electric-sql/pglite/worker";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Book, type SearchResult, getAllBooks, initDatabase, searchBooks } from "./db";

const SAMPLE_QUERIES = [
	"hary poter",
	"dostoevski",
	"greay gatspy",
	"frankenstin",
	"braev new wrld",
	"tolsoy",
	"charlote bronte",
	"don quixot",
	"hitchhikers guide",
	"cacher in the rie",
];

export default function App() {
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isLeader, setIsLeader] = useState<boolean | null>(null);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [allBooks, setAllBooks] = useState<Book[]>([]);
	const [searching, setSearching] = useState(false);
	const [searchTime, setSearchTime] = useState<number | null>(null);

	const pgRef = useRef<PGliteWorker | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let cancelled = false;
		initDatabase()
			.then(async (pg) => {
				if (cancelled) return;
				pgRef.current = pg;
				setIsLeader(pg.isLeader);
				pg.onLeaderChange(() => setIsLeader(pg.isLeader));
				const books = await getAllBooks(pg);
				setAllBooks(books);
				setReady(true);
			})
			.catch((e) => {
				if (!cancelled) setError(String(e));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const doSearch = useCallback(async (q: string) => {
		if (!pgRef.current || !q.trim()) {
			setResults([]);
			setSearchTime(null);
			setSearching(false);
			return;
		}
		setSearching(true);
		const start = performance.now();
		const res = await searchBooks(pgRef.current, q.trim());
		const elapsed = performance.now() - start;
		setResults(res);
		setSearchTime(elapsed);
		setSearching(false);
	}, []);

	const handleQueryChange = useCallback(
		(value: string) => {
			setQuery(value);
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => doSearch(value), 150);
		},
		[doSearch],
	);

	const handleSampleClick = useCallback(
		(sample: string) => {
			setQuery(sample);
			doSearch(sample);
			inputRef.current?.focus();
		},
		[doSearch],
	);

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
					<p className="subtitle">Loading pg_trgm extension</p>
				</div>
			</div>
		);
	}

	const hasQuery = query.trim().length > 0;

	return (
		<div className="container">
			<header className="header">
				<div className="title-row">
					<h1>Fuzzy Book Search</h1>
					<div className="badges">
						<span className="badge ext-badge">pg_trgm</span>
						<span className={`badge ${isLeader ? "leader-badge" : "follower-badge"}`}>
							{isLeader ? "Leader" : "Follower"}
						</span>
					</div>
				</div>
				<p className="description">
					PostgreSQL trigram fuzzy search running entirely in your browser via PGlite Web Worker.
					Handles typos, misspellings, and partial matches using the <code>pg_trgm</code> extension.
				</p>
			</header>

			<div className="search-section">
				<div className="search-box">
					<svg className="search-icon" viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
						<path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
					</svg>
					<input
						ref={inputRef}
						className="search-input"
						type="text"
						placeholder="Try a misspelled book title or author..."
						value={query}
						onChange={(e) => handleQueryChange(e.target.value)}
						autoFocus
					/>
					{hasQuery && (
						<button
							className="clear-btn"
							onClick={() => handleQueryChange("")}
							title="Clear"
						>
							&times;
						</button>
					)}
				</div>

				<div className="samples">
					<span className="samples-label">Try:</span>
					{SAMPLE_QUERIES.map((s) => (
						<button key={s} className="sample-chip" onClick={() => handleSampleClick(s)}>
							{s}
						</button>
					))}
				</div>
			</div>

			{hasQuery && (
				<div className="results-meta">
					<span>
						{results.length} result{results.length !== 1 && "s"}
						{searchTime !== null && ` in ${searchTime.toFixed(1)}ms`}
					</span>
					{searching && <span className="searching-indicator">Searching...</span>}
				</div>
			)}

			{hasQuery ? (
				<div className="results">
					{results.length === 0 && !searching && (
						<div className="empty-state">No matches found. Try a different spelling.</div>
					)}
					{results.map((r) => (
						<div key={r.id} className="result-card">
							<div className="result-main">
								<div className="result-title">{r.title}</div>
								<div className="result-author">{r.author}</div>
								<div className="result-meta-row">
									<span className="result-year">{r.year}</span>
									<span className="result-genre">{r.genre}</span>
								</div>
							</div>
							<div className="result-scores">
								<div className="score-main">
									<span className="score-value">{(r.score * 100).toFixed(0)}%</span>
									<span className="score-label">match</span>
								</div>
								<div className="score-bar-track">
									<div
										className="score-bar-fill"
										style={{
											width: `${Math.max(r.score * 100, 2)}%`,
											background: r.score > 0.5 ? "#3ecf8e" : r.score > 0.3 ? "#eab308" : "#f97316",
										}}
									/>
								</div>
								<div className="score-breakdown">
									<span>title: {(r.title_score * 100).toFixed(0)}%</span>
									<span>author: {(r.author_score * 100).toFixed(0)}%</span>
								</div>
							</div>
						</div>
					))}
				</div>
			) : (
				<>
					<div className="catalog-header">
						<span className="catalog-label">Catalog</span>
						<span className="catalog-count">{allBooks.length} books</span>
					</div>
					<div className="catalog">
						{allBooks.map((b) => (
							<div key={b.id} className="catalog-item">
								<div className="catalog-title">{b.title}</div>
								<div className="catalog-detail">
									<span>{b.author}</span>
									<span className="catalog-dot">&middot;</span>
									<span>{b.year}</span>
									<span className="catalog-dot">&middot;</span>
									<span className="catalog-genre">{b.genre}</span>
								</div>
							</div>
						))}
					</div>
				</>
			)}

			<div className="info-cards">
				<div className="info-card">
					<div className="info-label">How it works</div>
					<div className="info-value">
						The <code>pg_trgm</code> extension splits text into trigrams (3-character sequences).
						<strong> "hello"</strong> becomes <code>{"  h"}</code>, <code>{" he"}</code>,
						<code> hel</code>, <code>ell</code>, <code>llo</code>, <code>{"lo "}</code>.
						Similarity is the ratio of shared trigrams between the query and each column.
						This makes fuzzy matching resilient to typos and partial input.
					</div>
				</div>
				<div className="info-card">
					<div className="info-label">SQL behind the search</div>
					<div className="info-value">
						<pre className="sql-block">{`SELECT *, similarity(title, $1) AS title_score,
       similarity(author, $1) AS author_score,
       GREATEST(similarity(title, $1),
                similarity(author, $1)) AS score
FROM books
WHERE similarity(title, $1) > 0.1
   OR similarity(author, $1) > 0.1
ORDER BY score DESC`}</pre>
					</div>
				</div>
			</div>

			<footer className="footer">
				<p>
					<strong>@electric-sql/pglite/worker</strong> + <strong>pg_trgm</strong> extension
				</p>
				<p>
					IndexedDB (<code>idb://pglite-fuzzy-search</code>) &middot; {allBooks.length} books seeded
				</p>
			</footer>
		</div>
	);
}
