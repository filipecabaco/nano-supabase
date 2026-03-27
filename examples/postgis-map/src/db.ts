import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_ANON_KEY = "local-anon-key";
const SERVICE_ROLE_KEY = "local-service-role-key";

let supabaseInstance: SupabaseClient | null = null;
let initPromise: Promise<SupabaseClient> | null = null;

export async function initDatabase(): Promise<SupabaseClient> {
	if (supabaseInstance) return supabaseInstance;
	if (initPromise) return initPromise;

	initPromise = doInit();
	initPromise.catch(() => {
		initPromise = null;
	});
	return initPromise;
}

async function adminSql(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
	const res = await fetch(`${SUPABASE_URL}/admin/v1/sql`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
		},
		body: JSON.stringify({ sql, params }),
	});
	if (!res.ok) {
		const body = await res.json();
		throw new Error(body.message ?? `Admin SQL failed: ${res.status}`);
	}
	return res.json();
}

async function doInit(): Promise<SupabaseClient> {
	await adminSql("CREATE EXTENSION IF NOT EXISTS postgis");

	await adminSql(`
		CREATE TABLE IF NOT EXISTS places (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			category TEXT NOT NULL DEFAULT 'other',
			location GEOMETRY(Point, 4326) NOT NULL,
			created_at TIMESTAMP DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS places_location_idx ON places USING GIST (location);
	`);

	await adminSql(`
		CREATE OR REPLACE FUNCTION add_place(p_name TEXT, p_category TEXT, p_lng FLOAT, p_lat FLOAT)
		RETURNS TABLE(id INT, name TEXT, category TEXT, lat FLOAT, lng FLOAT, created_at TEXT) AS $$
			INSERT INTO places (name, category, location)
			VALUES (p_name, p_category, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
			RETURNING
				places.id,
				places.name,
				places.category,
				ST_Y(places.location)::float AS lat,
				ST_X(places.location)::float AS lng,
				places.created_at::text;
		$$ LANGUAGE sql;
	`);

	await adminSql(`
		CREATE OR REPLACE FUNCTION get_all_places()
		RETURNS TABLE(id INT, name TEXT, category TEXT, lat FLOAT, lng FLOAT, created_at TEXT) AS $$
			SELECT
				places.id,
				places.name,
				places.category,
				ST_Y(places.location)::float AS lat,
				ST_X(places.location)::float AS lng,
				places.created_at::text
			FROM places ORDER BY created_at DESC;
		$$ LANGUAGE sql;
	`);

	await adminSql(`
		CREATE OR REPLACE FUNCTION find_nearby(center_lng FLOAT, center_lat FLOAT, radius_km FLOAT)
		RETURNS TABLE(id INT, name TEXT, category TEXT, lat FLOAT, lng FLOAT, created_at TEXT, distance_km FLOAT) AS $$
			SELECT
				places.id,
				places.name,
				places.category,
				ST_Y(places.location)::float AS lat,
				ST_X(places.location)::float AS lng,
				places.created_at::text,
				(ST_Distance(
					places.location::geography,
					ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography
				) / 1000.0)::float AS distance_km
			FROM places
			WHERE ST_DWithin(
				places.location::geography,
				ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography,
				radius_km * 1000
			)
			ORDER BY distance_km;
		$$ LANGUAGE sql;
	`);

	await adminSql(`
		CREATE OR REPLACE FUNCTION delete_place(place_id INT)
		RETURNS void AS $$
			DELETE FROM places WHERE id = place_id;
		$$ LANGUAGE sql;
	`);

	await adminSql(`
		CREATE OR REPLACE FUNCTION get_place_stats()
		RETURNS TABLE(count BIGINT, bbox TEXT) AS $$
			SELECT
				COUNT(*),
				CASE WHEN COUNT(*) > 0
					THEN ST_AsText(ST_Extent(location))
					ELSE NULL
				END AS bbox
			FROM places;
		$$ LANGUAGE sql;
	`);

	supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
	return supabaseInstance;
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
	supabase: SupabaseClient,
	name: string,
	category: string,
	lat: number,
	lng: number,
): Promise<Place> {
	const { data, error } = await supabase.rpc("add_place", {
		p_name: name,
		p_category: category,
		p_lng: lng,
		p_lat: lat,
	});
	if (error) throw new Error(error.message);
	return (data as Place[])[0];
}

export async function getAllPlaces(supabase: SupabaseClient): Promise<Place[]> {
	const { data, error } = await supabase.rpc("get_all_places");
	if (error) throw new Error(error.message);
	return data as Place[];
}

export async function findNearby(
	supabase: SupabaseClient,
	lat: number,
	lng: number,
	radiusKm: number,
): Promise<Place[]> {
	const { data, error } = await supabase.rpc("find_nearby", {
		center_lng: lng,
		center_lat: lat,
		radius_km: radiusKm,
	});
	if (error) throw new Error(error.message);
	return data as Place[];
}

export async function deletePlace(supabase: SupabaseClient, id: number): Promise<void> {
	const { error } = await supabase.rpc("delete_place", { place_id: id });
	if (error) throw new Error(error.message);
}

export async function getStats(
	supabase: SupabaseClient,
): Promise<{ count: number; bbox: string | null }> {
	const { data, error } = await supabase.rpc("get_place_stats");
	if (error) throw new Error(error.message);
	const row = (data as { count: number; bbox: string | null }[])[0];
	return { count: Number(row.count), bbox: row.bbox };
}
