import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

let dbInstance: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;

export async function initDatabase(): Promise<PGlite> {
	if (dbInstance) return dbInstance;
	if (initPromise) return initPromise;

	initPromise = doInit();
	initPromise.catch(() => {
		initPromise = null;
	});
	return initPromise;
}

async function doInit(): Promise<PGlite> {
	const db = new PGlite({
		extensions: { pgcrypto, postgis },
	});

	await db.exec("CREATE EXTENSION IF NOT EXISTS postgis;");

	await db.exec(`
		CREATE TABLE IF NOT EXISTS places (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			category TEXT NOT NULL DEFAULT 'other',
			location GEOMETRY(Point, 4326) NOT NULL,
			created_at TIMESTAMP DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS places_location_idx ON places USING GIST (location);
	`);

	dbInstance = db;
	return db;
}

export interface Place {
	id: number;
	name: string;
	category: string;
	lat: number;
	lng: number;
	created_at: string;
	distance_km?: number;
}

export async function addPlace(
	db: PGlite,
	name: string,
	category: string,
	lat: number,
	lng: number,
): Promise<Place> {
	const result = await db.query<{
		id: number;
		name: string;
		category: string;
		lat: number;
		lng: number;
		created_at: string;
	}>(
		`INSERT INTO places (name, category, location)
		 VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))
		 RETURNING id, name, category,
		   ST_Y(location) AS lat, ST_X(location) AS lng,
		   created_at::text`,
		[name, category, lng, lat],
	);
	return result.rows[0];
}

export async function getAllPlaces(db: PGlite): Promise<Place[]> {
	const result = await db.query<Place>(
		`SELECT id, name, category,
		   ST_Y(location) AS lat, ST_X(location) AS lng,
		   created_at::text
		 FROM places ORDER BY created_at DESC`,
	);
	return result.rows;
}

export async function findNearby(
	db: PGlite,
	lat: number,
	lng: number,
	radiusKm: number,
): Promise<Place[]> {
	const result = await db.query<Place>(
		`SELECT id, name, category,
		   ST_Y(location) AS lat, ST_X(location) AS lng,
		   created_at::text,
		   ST_Distance(
		     location::geography,
		     ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
		   ) / 1000.0 AS distance_km
		 FROM places
		 WHERE ST_DWithin(
		   location::geography,
		   ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
		   $3
		 )
		 ORDER BY distance_km`,
		[lng, lat, radiusKm * 1000],
	);
	return result.rows;
}

export async function deletePlace(db: PGlite, id: number): Promise<void> {
	await db.query("DELETE FROM places WHERE id = $1", [id]);
}

export async function getStats(
	db: PGlite,
): Promise<{ count: number; bbox: string | null }> {
	const result = await db.query<{ count: string; bbox: string | null }>(
		`SELECT COUNT(*)::text AS count,
		   CASE WHEN COUNT(*) > 0
		     THEN ST_AsText(ST_Extent(location))
		     ELSE NULL
		   END AS bbox
		 FROM places`,
	);
	return {
		count: parseInt(result.rows[0].count, 10),
		bbox: result.rows[0].bbox,
	};
}
