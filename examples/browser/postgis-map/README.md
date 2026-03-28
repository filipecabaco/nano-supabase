# PostGIS Map

Interactive map application using PostGIS spatial queries, OpenStreetMap tiles, and Leaflet. Demonstrates geospatial features running entirely in-process via PGlite's PostGIS extension.

## What it shows

- Enabling the `postgis` extension in PGlite
- Creating spatial tables with `GEOMETRY(Point, 4326)` columns
- GiST spatial indexes for fast geospatial lookups
- SQL functions for adding places, finding nearby locations, and computing distances
- `ST_MakePoint`, `ST_SetSRID`, `ST_Distance`, `ST_DWithin`, `ST_Extent` PostGIS functions
- React + Leaflet map with OpenStreetMap tiles
- Click-to-add markers with category tagging
- Radius-based proximity search

## Prerequisites

Start the nano-supabase CLI server with the PostGIS extension:

```bash
npx nano-supabase start --extensions=postgis
```

## Run

```bash
cd examples/browser/postgis-map
pnpm install
pnpm run dev
```

Opens at http://localhost:5173. Click the map to add places, search nearby locations, and view stats.

## Key PostGIS APIs used

- `ST_MakePoint(lng, lat)` — create a point geometry
- `ST_SetSRID(geom, 4326)` — assign WGS84 coordinate system
- `ST_Distance(a::geography, b::geography)` — distance in meters
- `ST_DWithin(a::geography, b::geography, meters)` — proximity test
- `ST_Extent(geom)` — bounding box of all geometries
- `USING GIST (location)` — spatial index for fast queries

## Architecture

```
React UI (App.tsx)
  ↓ Leaflet map + click handlers
Database Layer (db.ts)
  ↓ supabase.rpc() calls to SQL functions
nano-supabase CLI server (localhost:54321)
  ↓ /admin/v1/sql for schema setup
PGlite + PostGIS extension
```
