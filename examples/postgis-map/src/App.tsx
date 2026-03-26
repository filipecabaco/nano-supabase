import type { PGlite } from "@electric-sql/pglite";
import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	CircleMarker,
	MapContainer,
	Marker,
	Popup,
	TileLayer,
	useMapEvents,
} from "react-leaflet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	type Place,
	addPlace,
	deletePlace,
	findNearby,
	getAllPlaces,
	getStats,
	initDatabase,
} from "./db";

const CATEGORIES = [
	{ value: "restaurant", label: "Restaurant", color: "#ef4444" },
	{ value: "park", label: "Park", color: "#22c55e" },
	{ value: "shop", label: "Shop", color: "#3b82f6" },
	{ value: "landmark", label: "Landmark", color: "#f59e0b" },
	{ value: "transit", label: "Transit", color: "#8b5cf6" },
	{ value: "other", label: "Other", color: "#6b7280" },
] as const;

function categoryColor(category: string): string {
	return (
		CATEGORIES.find((c) => c.value === category)?.color ?? "#6b7280"
	);
}

function createMarkerIcon(category: string): L.DivIcon {
	const color = categoryColor(category);
	return L.divIcon({
		className: "",
		iconSize: [28, 28],
		iconAnchor: [14, 14],
		popupAnchor: [0, -16],
		html: `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
			<circle cx="14" cy="14" r="12" fill="${color}" fill-opacity="0.9" stroke="#fff" stroke-width="2"/>
			<circle cx="14" cy="14" r="4" fill="#fff"/>
		</svg>`,
	});
}

function MapClickHandler({
	onClick,
}: {
	onClick: (lat: number, lng: number) => void;
}) {
	useMapEvents({
		click(e) {
			onClick(e.latlng.lat, e.latlng.lng);
		},
	});
	return null;
}

function App() {
	const [db, setDb] = useState<PGlite | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [places, setPlaces] = useState<Place[]>([]);
	const [stats, setStats] = useState<{ count: number; bbox: string | null }>({
		count: 0,
		bbox: null,
	});

	const [pendingClick, setPendingClick] = useState<{
		lat: number;
		lng: number;
	} | null>(null);
	const [newName, setNewName] = useState("");
	const [newCategory, setNewCategory] = useState("landmark");
	const [adding, setAdding] = useState(false);

	const [searchCenter, setSearchCenter] = useState<{
		lat: number;
		lng: number;
	} | null>(null);
	const [searchRadius, setSearchRadius] = useState(5);
	const [nearbyResults, setNearbyResults] = useState<Place[] | null>(null);

	const nameInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		initDatabase()
			.then(async (instance) => {
				setDb(instance);
				const [allPlaces, allStats] = await Promise.all([
					getAllPlaces(instance),
					getStats(instance),
				]);
				setPlaces(allPlaces);
				setStats(allStats);
			})
			.catch((err) => setError((err as Error).message))
			.finally(() => setLoading(false));
	}, []);

	const refreshData = useCallback(
		async (instance: PGlite) => {
			const [allPlaces, allStats] = await Promise.all([
				getAllPlaces(instance),
				getStats(instance),
			]);
			setPlaces(allPlaces);
			setStats(allStats);
			if (searchCenter) {
				const nearby = await findNearby(
					instance,
					searchCenter.lat,
					searchCenter.lng,
					searchRadius,
				);
				setNearbyResults(nearby);
			}
		},
		[searchCenter, searchRadius],
	);

	function handleMapClick(lat: number, lng: number) {
		setPendingClick({ lat, lng });
		setNewName("");
		setNewCategory("landmark");
		setTimeout(() => nameInputRef.current?.focus(), 50);
	}

	async function handleAddPlace(e: React.FormEvent) {
		e.preventDefault();
		if (!db || !pendingClick || !newName.trim()) return;
		setAdding(true);
		setError(null);
		try {
			await addPlace(
				db,
				newName.trim(),
				newCategory,
				pendingClick.lat,
				pendingClick.lng,
			);
			setPendingClick(null);
			setNewName("");
			await refreshData(db);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setAdding(false);
		}
	}

	async function handleDelete(id: number) {
		if (!db) return;
		try {
			await deletePlace(db, id);
			await refreshData(db);
		} catch (err) {
			setError((err as Error).message);
		}
	}

	async function handleSearchNearby() {
		if (!db || !searchCenter) return;
		try {
			const nearby = await findNearby(
				db,
				searchCenter.lat,
				searchCenter.lng,
				searchRadius,
			);
			setNearbyResults(nearby);
		} catch (err) {
			setError((err as Error).message);
		}
	}

	function handleSetSearchCenter(lat: number, lng: number) {
		setSearchCenter({ lat, lng });
		setNearbyResults(null);
	}

	if (loading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
					<p className="text-muted-foreground text-sm">
						Loading PostGIS (WASM)...
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex flex-col">
			<header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
				<div className="flex items-center gap-3">
					<svg
						width="28"
						height="28"
						viewBox="0 0 64 64"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<circle
							cx="32"
							cy="28"
							r="22"
							fill="url(#map_grad)"
							stroke="#249361"
							strokeWidth="1.5"
						/>
						<path
							d="M32 50C32 50 50 36 50 28C50 18 42 10 32 10C22 10 14 18 14 28C14 36 32 50 32 50Z"
							fill="#3ECF8E"
							fillOpacity="0.2"
							stroke="#3ECF8E"
							strokeWidth="2"
						/>
						<circle cx="32" cy="28" r="6" fill="#3ECF8E" />
						<circle cx="32" cy="28" r="3" fill="#171717" />
						<defs>
							<linearGradient
								id="map_grad"
								x1="10"
								y1="6"
								x2="54"
								y2="50"
								gradientUnits="userSpaceOnUse"
							>
								<stop stopColor="#1C1C1C" />
								<stop offset="1" stopColor="#249361" stopOpacity="0.3" />
							</linearGradient>
						</defs>
					</svg>
					<span className="text-lg font-semibold">nano-map</span>
				</div>
				<div className="flex items-center gap-4">
					<span className="text-sm text-muted-foreground">
						{stats.count} places
					</span>
					<Badge variant="secondary">PostGIS + PGlite</Badge>
				</div>
			</header>

			{error && (
				<div className="mx-6 mt-4">
					<Alert variant="destructive">
						<AlertDescription className="flex justify-between items-center">
							<span>{error}</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setError(null)}
								className="text-xs"
							>
								Dismiss
							</Button>
						</AlertDescription>
					</Alert>
				</div>
			)}

			<main className="flex-1 flex gap-4 p-4 min-h-0">
				<div className="flex-1 flex flex-col gap-4 min-h-0">
					<div className="flex-1 rounded-lg overflow-hidden border border-border min-h-[400px]">
						<MapContainer
							center={[48.8566, 2.3522]}
							zoom={4}
							className="h-full w-full"
						>
							<TileLayer
								attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
								url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
							/>
							<MapClickHandler onClick={handleMapClick} />

							{places.map((place) => (
								<Marker
									key={place.id}
									position={[place.lat, place.lng]}
									icon={createMarkerIcon(place.category)}
								>
									<Popup>
										<div className="space-y-1">
											<div className="font-semibold">{place.name}</div>
											<div className="text-xs opacity-70">
												{place.category} &middot;{" "}
												{place.lat.toFixed(4)}, {place.lng.toFixed(4)}
											</div>
											<div className="flex gap-2 pt-1">
												<button
													className="text-xs text-blue-400 hover:underline"
													onClick={() =>
														handleSetSearchCenter(place.lat, place.lng)
													}
												>
													Find nearby
												</button>
												<button
													className="text-xs text-red-400 hover:underline"
													onClick={() => handleDelete(place.id)}
												>
													Delete
												</button>
											</div>
										</div>
									</Popup>
								</Marker>
							))}

							{pendingClick && (
								<CircleMarker
									center={[pendingClick.lat, pendingClick.lng]}
									radius={8}
									pathOptions={{
										color: "#3ecf8e",
										fillColor: "#3ecf8e",
										fillOpacity: 0.5,
										weight: 2,
									}}
								/>
							)}

							{searchCenter && (
								<CircleMarker
									center={[searchCenter.lat, searchCenter.lng]}
									radius={10}
									pathOptions={{
										color: "#f59e0b",
										fillColor: "#f59e0b",
										fillOpacity: 0.3,
										weight: 2,
										dashArray: "4 4",
									}}
								/>
							)}
						</MapContainer>
					</div>

					{pendingClick && (
						<Card className="py-4">
							<CardContent className="py-0">
								<form onSubmit={handleAddPlace} className="flex gap-3 items-end">
									<div className="flex-1 space-y-1">
										<label className="text-xs text-muted-foreground">
											Name
										</label>
										<Input
											ref={nameInputRef}
											value={newName}
											onChange={(e) => setNewName(e.target.value)}
											placeholder="Place name..."
											required
										/>
									</div>
									<div className="space-y-1">
										<label className="text-xs text-muted-foreground">
											Category
										</label>
										<select
											value={newCategory}
											onChange={(e) => setNewCategory(e.target.value)}
											className="h-9 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
										>
											{CATEGORIES.map((c) => (
												<option key={c.value} value={c.value}>
													{c.label}
												</option>
											))}
										</select>
									</div>
									<div className="text-xs text-muted-foreground whitespace-nowrap pb-2">
										{pendingClick.lat.toFixed(4)}, {pendingClick.lng.toFixed(4)}
									</div>
									<Button type="submit" size="sm" disabled={adding || !newName.trim()}>
										{adding ? "Adding..." : "Add Place"}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => setPendingClick(null)}
									>
										Cancel
									</Button>
								</form>
							</CardContent>
						</Card>
					)}
				</div>

				<div className="w-80 flex flex-col gap-4 overflow-y-auto">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Nearby Search</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<p className="text-xs text-muted-foreground">
								{searchCenter
									? `Center: ${searchCenter.lat.toFixed(4)}, ${searchCenter.lng.toFixed(4)}`
									: "Click \"Find nearby\" on a marker or click the map to set a search center"}
							</p>
							<div className="flex gap-2 items-end">
								<div className="flex-1 space-y-1">
									<label className="text-xs text-muted-foreground">
										Radius (km)
									</label>
									<Input
										type="number"
										min={1}
										max={20000}
										value={searchRadius}
										onChange={(e) =>
											setSearchRadius(parseInt(e.target.value, 10) || 5)
										}
									/>
								</div>
								<Button
									size="sm"
									variant="outline"
									onClick={handleSearchNearby}
									disabled={!searchCenter}
								>
									Search
								</Button>
							</div>
							{nearbyResults !== null && (
								<div className="space-y-1 pt-2 border-t border-border">
									<p className="text-xs text-muted-foreground">
										{nearbyResults.length} result
										{nearbyResults.length !== 1 ? "s" : ""} within{" "}
										{searchRadius} km
									</p>
									{nearbyResults.map((p) => (
										<div
											key={p.id}
											className="flex items-center gap-2 text-xs py-1"
										>
											<span
												className="w-2 h-2 rounded-full shrink-0"
												style={{ background: categoryColor(p.category) }}
											/>
											<span className="truncate flex-1">{p.name}</span>
											<span className="text-muted-foreground whitespace-nowrap">
												{p.distance_km !== undefined
													? `${p.distance_km < 1 ? `${Math.round(p.distance_km * 1000)}m` : `${p.distance_km.toFixed(1)}km`}`
													: ""}
											</span>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					<Card className="flex-1 overflow-hidden flex flex-col">
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">
								All Places ({places.length})
							</CardTitle>
						</CardHeader>
						<CardContent className="overflow-y-auto flex-1 space-y-1">
							{places.length === 0 ? (
								<p className="text-xs text-muted-foreground py-4 text-center">
									Click anywhere on the map to add a place.
								</p>
							) : (
								places.map((place) => (
									<div
										key={place.id}
										className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/50 group"
									>
										<span
											className="w-2.5 h-2.5 rounded-full shrink-0"
											style={{ background: categoryColor(place.category) }}
										/>
										<div className="flex-1 min-w-0">
											<div className="text-sm truncate">{place.name}</div>
											<div className="text-xs text-muted-foreground">
												{place.lat.toFixed(4)}, {place.lng.toFixed(4)}
											</div>
										</div>
										<Badge variant="secondary" className="text-[10px] shrink-0">
											{place.category}
										</Badge>
										<button
											className="text-xs text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
											onClick={() => handleDelete(place.id)}
										>
											x
										</button>
									</div>
								))
							)}
						</CardContent>
					</Card>
				</div>
			</main>
		</div>
	);
}

export default App;
