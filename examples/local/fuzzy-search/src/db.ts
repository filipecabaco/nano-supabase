import { PGliteWorker } from "@electric-sql/pglite/worker";

export interface Book {
	id: number;
	title: string;
	author: string;
	year: number;
	genre: string;
}

export interface SearchResult extends Book {
	title_score: number;
	author_score: number;
	score: number;
}

let pgWorker: PGliteWorker | null = null;
let initPromise: Promise<PGliteWorker> | null = null;

const SEED_BOOKS: Omit<Book, "id">[] = [
	{ title: "The Great Gatsby", author: "F. Scott Fitzgerald", year: 1925, genre: "Fiction" },
	{ title: "To Kill a Mockingbird", author: "Harper Lee", year: 1960, genre: "Fiction" },
	{ title: "1984", author: "George Orwell", year: 1949, genre: "Dystopian" },
	{ title: "Pride and Prejudice", author: "Jane Austen", year: 1813, genre: "Romance" },
	{ title: "The Catcher in the Rye", author: "J.D. Salinger", year: 1951, genre: "Fiction" },
	{ title: "One Hundred Years of Solitude", author: "Gabriel Garcia Marquez", year: 1967, genre: "Magic Realism" },
	{ title: "Brave New World", author: "Aldous Huxley", year: 1932, genre: "Dystopian" },
	{ title: "The Lord of the Rings", author: "J.R.R. Tolkien", year: 1954, genre: "Fantasy" },
	{ title: "Harry Potter and the Philosopher's Stone", author: "J.K. Rowling", year: 1997, genre: "Fantasy" },
	{ title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", year: 1979, genre: "Science Fiction" },
	{ title: "Moby Dick", author: "Herman Melville", year: 1851, genre: "Adventure" },
	{ title: "War and Peace", author: "Leo Tolstoy", year: 1869, genre: "Historical Fiction" },
	{ title: "Crime and Punishment", author: "Fyodor Dostoevsky", year: 1866, genre: "Psychological Fiction" },
	{ title: "The Brothers Karamazov", author: "Fyodor Dostoevsky", year: 1880, genre: "Philosophical Fiction" },
	{ title: "Don Quixote", author: "Miguel de Cervantes", year: 1605, genre: "Satire" },
	{ title: "Frankenstein", author: "Mary Shelley", year: 1818, genre: "Gothic" },
	{ title: "Dracula", author: "Bram Stoker", year: 1897, genre: "Gothic Horror" },
	{ title: "The Picture of Dorian Gray", author: "Oscar Wilde", year: 1890, genre: "Gothic" },
	{ title: "Wuthering Heights", author: "Emily Bronte", year: 1847, genre: "Romance" },
	{ title: "Jane Eyre", author: "Charlotte Bronte", year: 1847, genre: "Romance" },
	{ title: "Great Expectations", author: "Charles Dickens", year: 1861, genre: "Fiction" },
	{ title: "A Tale of Two Cities", author: "Charles Dickens", year: 1859, genre: "Historical Fiction" },
	{ title: "The Alchemist", author: "Paulo Coelho", year: 1988, genre: "Fiction" },
	{ title: "Dune", author: "Frank Herbert", year: 1965, genre: "Science Fiction" },
	{ title: "Neuromancer", author: "William Gibson", year: 1984, genre: "Cyberpunk" },
	{ title: "Slaughterhouse-Five", author: "Kurt Vonnegut", year: 1969, genre: "Science Fiction" },
	{ title: "The Handmaid's Tale", author: "Margaret Atwood", year: 1985, genre: "Dystopian" },
	{ title: "Beloved", author: "Toni Morrison", year: 1987, genre: "Historical Fiction" },
	{ title: "Catch-22", author: "Joseph Heller", year: 1961, genre: "Satire" },
	{ title: "The Road", author: "Cormac McCarthy", year: 2006, genre: "Post-Apocalyptic" },
];

export async function initDatabase(): Promise<PGliteWorker> {
	if (pgWorker) return pgWorker;
	if (initPromise) return initPromise;

	initPromise = doInit();
	initPromise.catch(() => {
		initPromise = null;
	});
	return initPromise;
}

async function doInit(): Promise<PGliteWorker> {
	const pg = await PGliteWorker.create(
		new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
		{ dataDir: "idb://pglite-fuzzy-search" },
	);

	await pg.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm");

	await pg.exec(`
		CREATE TABLE IF NOT EXISTS books (
			id SERIAL PRIMARY KEY,
			title TEXT NOT NULL,
			author TEXT NOT NULL,
			year INTEGER NOT NULL,
			genre TEXT NOT NULL
		)
	`);

	await pg.exec("CREATE INDEX IF NOT EXISTS idx_books_title_trgm ON books USING GIN (title gin_trgm_ops)");
	await pg.exec("CREATE INDEX IF NOT EXISTS idx_books_author_trgm ON books USING GIN (author gin_trgm_ops)");

	const { rows } = await pg.query<{ count: string }>("SELECT count(*)::text AS count FROM books");
	if (rows[0].count === "0") {
		for (const book of SEED_BOOKS) {
			await pg.query(
				"INSERT INTO books (title, author, year, genre) VALUES ($1, $2, $3, $4)",
				[book.title, book.author, book.year, book.genre],
			);
		}
	}

	pgWorker = pg;
	return pg;
}

export async function searchBooks(pg: PGliteWorker, query: string): Promise<SearchResult[]> {
	const { rows } = await pg.query<SearchResult>(
		`SELECT id, title, author, year, genre,
			similarity(title, $1) AS title_score,
			similarity(author, $1) AS author_score,
			GREATEST(similarity(title, $1), similarity(author, $1)) AS score
		FROM books
		WHERE similarity(title, $1) > 0.1 OR similarity(author, $1) > 0.1
		ORDER BY score DESC`,
		[query],
	);
	return rows;
}

export async function getAllBooks(pg: PGliteWorker): Promise<Book[]> {
	const { rows } = await pg.query<Book>("SELECT * FROM books ORDER BY title");
	return rows;
}
