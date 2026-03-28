import { PGliteWorker } from "@electric-sql/pglite/worker";

export interface Todo {
	id: number;
	title: string;
	done: boolean;
	created_at: string;
}

let instance: PGliteWorker | null = null;
let initPromise: Promise<PGliteWorker> | null = null;

export function getDb(): Promise<PGliteWorker> {
	if (instance) return Promise.resolve(instance);
	if (initPromise) return initPromise;

	initPromise = PGliteWorker.create(
		new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
		{ dataDir: "idb://pglite-workers-demo" },
	).then((pg) => {
		instance = pg;
		return pg;
	});

	initPromise.catch(() => {
		initPromise = null;
	});

	return initPromise;
}

export async function addTodo(title: string): Promise<Todo> {
	const db = await getDb();
	const result = await db.query<Todo>(
		"INSERT INTO todos (title) VALUES ($1) RETURNING *",
		[title],
	);
	return result.rows[0];
}

export async function toggleTodo(id: number, done: boolean): Promise<void> {
	const db = await getDb();
	await db.query("UPDATE todos SET done = $1 WHERE id = $2", [done, id]);
}

export async function deleteTodo(id: number): Promise<void> {
	const db = await getDb();
	await db.query("DELETE FROM todos WHERE id = $1", [id]);
}

export async function listTodos(): Promise<Todo[]> {
	const db = await getDb();
	const result = await db.query<Todo>(
		"SELECT * FROM todos ORDER BY created_at DESC",
	);
	return result.rows;
}
