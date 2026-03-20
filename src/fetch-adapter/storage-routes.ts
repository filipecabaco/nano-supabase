import type { PGlite } from "@electric-sql/pglite";
import type { StorageHandler } from "../storage/handler.ts";
import { setAuthContext } from "./auth-context.ts";
import { extractBearerToken, parseBody } from "./index.ts";
import { errorResponse, jsonResponse } from "./response.ts";

/**
 * Read the request body as a Uint8Array (for file uploads)
 * Handles multipart/form-data and raw body
 */
async function readFileBody(
	request: Request,
): Promise<{ data: Uint8Array; contentType: string }> {
	const requestContentType = request.headers.get("Content-Type") || "";

	if (requestContentType.includes("multipart/form-data")) {
		const formData = await request.formData();
		// supabase-js puts the file in a field called "" (empty string) or the first field
		// Try common field names
		for (const fieldName of ["", "file", "data"]) {
			const value = formData.get(fieldName);
			if (value instanceof Blob) {
				const arrayBuffer = await value.arrayBuffer();
				return {
					data: new Uint8Array(arrayBuffer),
					contentType: value.type || "application/octet-stream",
				};
			}
		}
		throw new Error("No file found in form data");
	}

	// Raw body
	const arrayBuffer = await request.arrayBuffer();
	return {
		data: new Uint8Array(arrayBuffer),
		contentType: requestContentType || "application/octet-stream",
	};
}

// ─── TUS Resumable Upload Sessions ────────────────────────────────────

interface TusSession {
	bucketId: string;
	objectName: string;
	contentType: string;
	cacheControl?: string;
	upsert: boolean;
	ownerId?: string;
	uploadLength: number;
	chunks: Uint8Array[];
	offset: number;
	createdAt: number;
}

export type TusSessionMap = Map<string, TusSession>;

function parseTusMetadata(header: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const pair of header.split(",")) {
		const [key, value] = pair.trim().split(" ");
		if (key && value) result[key] = atob(value);
	}
	return result;
}

// ─── Main Router ──────────────────────────────────────────────────────

export async function handleStorageRoute(
	request: Request,
	pathname: string,
	db: PGlite,
	storageHandler: StorageHandler,
	tusSessions: TusSessionMap,
): Promise<Response> {
	// Expire TUS sessions older than 24 hours
	const cutoff = Date.now() - 86_400_000;
	for (const [id, session] of tusSessions) {
		if (session.createdAt < cutoff) tusSessions.delete(id);
	}
	const method = request.method.toUpperCase();
	const token = extractBearerToken(request.headers);

	// Set auth context variables (for RLS policies that reference auth.uid()),
	// then RESET ROLE so storage operations run as superuser — matching real
	// Supabase where the storage server uses supabase_storage_admin.
	const authCtx = await setAuthContext(db, token);
	await db.exec("RESET ROLE");

	try {
		// ── Bucket routes: /storage/v1/bucket ──────────────────────────

		if (pathname === "/storage/v1/bucket" && method === "GET") {
			return await handleListBuckets(storageHandler);
		}

		if (pathname === "/storage/v1/bucket" && method === "POST") {
			return await handleCreateBucket(request, storageHandler);
		}

		// /storage/v1/bucket/:id/empty
		const emptyMatch = pathname.match(
			/^\/storage\/v1\/bucket\/([^/]+)\/empty$/,
		);
		if (emptyMatch && method === "POST") {
			return await handleEmptyBucket(emptyMatch[1]!, storageHandler);
		}

		// /storage/v1/bucket/:id
		const bucketIdMatch = pathname.match(/^\/storage\/v1\/bucket\/([^/]+)$/);
		if (bucketIdMatch) {
			const bucketId = bucketIdMatch[1]!;
			if (method === "GET")
				return await handleGetBucket(bucketId, storageHandler);
			if (method === "PUT")
				return await handleUpdateBucket(bucketId, request, storageHandler);
			if (method === "DELETE")
				return await handleDeleteBucket(bucketId, storageHandler);
		}

		// ── Object routes ──────────────────────────────────────────────

		// POST /storage/v1/object/move
		if (pathname === "/storage/v1/object/move" && method === "POST") {
			return await handleMoveObject(request, storageHandler);
		}

		// POST /storage/v1/object/copy
		if (pathname === "/storage/v1/object/copy" && method === "POST") {
			return await handleCopyObject(request, storageHandler);
		}

		const signMatch = pathname.match(
			/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/,
		);
		if (signMatch) {
			if (method === "POST") {
				return await handleCreateSignedUrl(
					signMatch[1]!,
					signMatch[2]!,
					request,
					storageHandler,
				);
			}
			if (method === "GET") {
				const url = new URL(request.url);
				const signedToken = url.searchParams.get("token");
				if (signedToken) {
					return await handleSignedDownload(signedToken, db, storageHandler);
				}
			}
		}

		const signBatchMatch = pathname.match(
			/^\/storage\/v1\/object\/sign\/([^/]+)$/,
		);
		if (signBatchMatch && method === "POST") {
			return await handleCreateSignedUrls(
				signBatchMatch[1]!,
				request,
				storageHandler,
			);
		}

		// GET /storage/v1/object/public/:bucketId/:path — public download
		const publicMatch = pathname.match(
			/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/,
		);
		if (publicMatch && method === "GET") {
			return await handlePublicDownload(
				publicMatch[1]!,
				publicMatch[2]!,
				db,
				storageHandler,
			);
		}

		// GET /storage/v1/object/info/:bucketId/:path — object info
		const infoMatch = pathname.match(
			/^\/storage\/v1\/object\/info\/([^/]+)\/(.+)$/,
		);
		if (infoMatch && method === "GET") {
			return await handleObjectInfo(
				infoMatch[1]!,
				infoMatch[2]!,
				storageHandler,
			);
		}

		// POST /storage/v1/object/list/:bucketId — list objects
		const listMatch = pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
		if (listMatch && method === "POST") {
			return await handleListObjects(listMatch[1]!, request, storageHandler);
		}

		// DELETE /storage/v1/object/:bucketId — remove objects (batch)
		const removeMatch = pathname.match(/^\/storage\/v1\/object\/([^/]+)$/);
		if (removeMatch && method === "DELETE") {
			return await handleRemoveObjects(
				removeMatch[1]!,
				request,
				storageHandler,
			);
		}

		// POST /storage/v1/object/:bucketId/:path — upload
		const uploadMatch = pathname.match(
			/^\/storage\/v1\/object\/([^/]+)\/(.+)$/,
		);
		if (uploadMatch && method === "POST") {
			return await handleUpload(
				uploadMatch[1]!,
				uploadMatch[2]!,
				request,
				storageHandler,
				{ ownerId: authCtx.userId, upsert: false },
			);
		}

		if (uploadMatch && method === "PUT") {
			return await handleUpload(
				uploadMatch[1]!,
				uploadMatch[2]!,
				request,
				storageHandler,
				{ ownerId: authCtx.userId, upsert: true },
			);
		}

		// GET /storage/v1/object/:bucketId/:path — download
		const downloadMatch = pathname.match(
			/^\/storage\/v1\/object\/([^/]+)\/(.+)$/,
		);
		if (downloadMatch && method === "GET") {
			return await handleDownload(
				downloadMatch[1]!,
				downloadMatch[2]!,
				storageHandler,
			);
		}

		// HEAD /storage/v1/object/:bucketId/:path — exists check
		if (downloadMatch && method === "HEAD") {
			return await handleExists(
				downloadMatch[1]!,
				downloadMatch[2]!,
				storageHandler,
			);
		}

		// ── TUS resumable upload ───────────────────────────────────────

		// POST /storage/v1/upload/resumable — create session
		if (pathname === "/storage/v1/upload/resumable" && method === "POST") {
			const meta = parseTusMetadata(
				request.headers.get("Upload-Metadata") ?? "",
			);
			const bucketId = meta["bucketName"];
			const objectName = meta["objectName"];
			const contentType = meta["contentType"] ?? "application/octet-stream";
			const cacheControl = meta["cacheControl"];
			if (!bucketId || !objectName)
				return errorResponse("Missing Upload-Metadata", 400);

			const uploadLength = parseInt(
				request.headers.get("Upload-Length") ?? "0",
				10,
			);
			const upsert = request.headers.get("x-upsert") === "true";
			const uploadId = crypto.randomUUID();

			tusSessions.set(uploadId, {
				bucketId,
				objectName,
				contentType,
				cacheControl,
				upsert,
				ownerId: authCtx.userId,
				uploadLength,
				chunks: [],
				offset: 0,
				createdAt: Date.now(),
			});

			return new Response(null, {
				status: 201,
				headers: {
					Location: `/storage/v1/upload/resumable?uploadId=${uploadId}`,
					"Tus-Resumable": "1.0.0",
					"Upload-Offset": "0",
				},
			});
		}

		// HEAD /storage/v1/upload/resumable?uploadId=... — check offset
		if (pathname === "/storage/v1/upload/resumable" && method === "HEAD") {
			const uploadId = new URL(request.url).searchParams.get("uploadId") ?? "";
			const session = tusSessions.get(uploadId);
			if (!session) return errorResponse("Upload not found", 404);
			return new Response(null, {
				status: 200,
				headers: {
					"Tus-Resumable": "1.0.0",
					"Upload-Offset": String(session.offset),
					"Upload-Length": String(session.uploadLength),
					"Cache-Control": "no-store",
				},
			});
		}

		// PATCH /storage/v1/upload/resumable?uploadId=... — upload chunk
		if (pathname === "/storage/v1/upload/resumable" && method === "PATCH") {
			const uploadId = new URL(request.url).searchParams.get("uploadId") ?? "";
			const session = tusSessions.get(uploadId);
			if (!session) return errorResponse("Upload not found", 404);

			const chunk = new Uint8Array(await request.arrayBuffer());
			session.chunks.push(chunk);
			session.offset += chunk.byteLength;

			if (session.offset >= session.uploadLength) {
				const combined = new Uint8Array(session.offset);
				let pos = 0;
				for (const c of session.chunks) {
					combined.set(c, pos);
					pos += c.byteLength;
				}
				tusSessions.delete(uploadId);

				const obj = await storageHandler.uploadObject(
					session.bucketId,
					session.objectName,
					combined,
					session.contentType,
					{
						cacheControl: session.cacheControl,
						upsert: session.upsert,
						ownerId: session.ownerId,
					},
				);

				return new Response(
					JSON.stringify({
						Id: obj.id,
						Key: `${session.bucketId}/${session.objectName}`,
					}),
					{
						status: 204,
						headers: {
							"Tus-Resumable": "1.0.0",
							"Upload-Offset": String(session.offset),
							"Content-Type": "application/json",
						},
					},
				);
			}

			return new Response(null, {
				status: 204,
				headers: {
					"Tus-Resumable": "1.0.0",
					"Upload-Offset": String(session.offset),
				},
			});
		}

		// ── Signed upload URL ─────────────────────────────────────────

		// POST /storage/v1/object/upload/sign/:bucketId/:path — create signed upload URL
		const signedUploadCreateMatch = pathname.match(
			/^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/,
		);
		if (signedUploadCreateMatch && method === "POST") {
			const bucketId = signedUploadCreateMatch[1]!;
			const objectPath = signedUploadCreateMatch[2]!;
			const body = await parseBody(request);
			const expiresIn = (typeof body.expiresIn === "number" ? body.expiresIn : 3600);
			try {
				const uploadToken = await storageHandler.createSignedUrl(
					bucketId,
					objectPath,
					expiresIn,
				);
				const signedUrl = `/storage/v1/object/upload/sign/${bucketId}/${objectPath}?token=${uploadToken}`;
				return jsonResponse({
					signedUrl,
					token: uploadToken,
					path: `${bucketId}/${objectPath}`,
				});
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: "Failed to create signed upload URL";
				return errorResponse(message, 500);
			}
		}

		// PUT /storage/v1/object/upload/sign/:bucketId/:path?token=... — upload via signed URL
		if (signedUploadCreateMatch && method === "PUT") {
			const signedToken = new URL(request.url).searchParams.get("token");
			if (!signedToken) return errorResponse("Missing token", 400);

			const payload = await storageHandler.verifySignedUrl(signedToken);
			if (!payload) return errorResponse("Invalid or expired signed URL", 401);

			return await handleUpload(
				signedUploadCreateMatch[1]!,
				signedUploadCreateMatch[2]!,
				request,
				storageHandler,
				{ ownerId: authCtx.userId, upsert: true },
			);
		}

		// ── List objects v2 ─────────────────────────────────────────────

		// POST /storage/v1/object/list-v2/:bucketId
		const listV2Match = pathname.match(
			/^\/storage\/v1\/object\/list-v2\/([^/]+)$/,
		);
		if (listV2Match && method === "POST") {
			const body = await parseBody(request);
			const objects = await storageHandler.listObjects(listV2Match[1]!, {
				prefix: typeof body.prefix === "string" ? body.prefix : undefined,
				limit: typeof body.limit === "number" ? body.limit : undefined,
				offset: typeof body.offset === "number" ? body.offset : undefined,
				sortBy: typeof body.sortBy === "object" && body.sortBy !== null ? body.sortBy as { column: string; order: string } : undefined,
				search: typeof body.search === "string" ? body.search : undefined,
			});

			const prefix = typeof body.prefix === "string" ? body.prefix : "";
			const prefixes: { name: string }[] = [];
			const items: Record<string, unknown>[] = [];

			for (const obj of objects) {
				const relativeName = obj.name.startsWith(prefix)
					? obj.name.slice(prefix.length)
					: obj.name;

				if (relativeName.endsWith("/")) {
					prefixes.push({ name: relativeName });
				} else {
					items.push({
						name: relativeName,
						id: obj.id,
						updated_at: obj.updated_at,
						created_at: obj.created_at,
						last_accessed_at: obj.last_accessed_at,
						metadata: obj.metadata,
					});
				}
			}

			return jsonResponse({ prefixes, objects: items });
		}

		// ── Render routes (stub) ───────────────────────────────────────

		// GET /storage/v1/render/image/authenticated/:bucketId/:path
		const renderMatch = pathname.match(
			/^\/storage\/v1\/render\/image\/(?:authenticated|public)\/([^/]+)\/(.+)$/,
		);
		if (renderMatch && method === "GET") {
			// Return original image — no transforms in local emulation
			return await handleDownload(
				renderMatch[1]!,
				renderMatch[2]!,
				storageHandler,
			);
		}

		// GET /storage/v1/render/image/sign/:bucketId/:path?token=... — render signed image
		const renderSignedMatch = pathname.match(
			/^\/storage\/v1\/render\/image\/sign\/([^/]+)\/(.+)$/,
		);
		if (renderSignedMatch && method === "GET") {
			const signedToken = new URL(request.url).searchParams.get("token");
			if (!signedToken) return errorResponse("Missing token", 400);

			const payload = await storageHandler.verifySignedUrl(signedToken);
			if (!payload) return errorResponse("Invalid or expired signed URL", 401);

			return await handleDownload(
				payload.bucket_id,
				payload.object_name,
				storageHandler,
			);
		}

		return errorResponse("Storage endpoint not found", 404);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Internal error";
		return errorResponse(message, 500);
	}
}

// ─── Bucket Handlers ──────────────────────────────────────────────────

async function handleListBuckets(handler: StorageHandler): Promise<Response> {
	const buckets = await handler.listBuckets();
	return jsonResponse(buckets);
}

async function handleGetBucket(
	id: string,
	handler: StorageHandler,
): Promise<Response> {
	const bucket = await handler.getBucket(id);
	if (!bucket) return errorResponse("Bucket not found", 404);
	return jsonResponse(bucket);
}

async function handleCreateBucket(
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);
	const name = typeof body.name === "string" ? body.name : typeof body.id === "string" ? body.id : undefined;
	if (!name) return errorResponse("Bucket name is required");

	try {
		const bucket = await handler.createBucket({
			id: typeof body.id === "string" ? body.id : name,
			name,
			public: typeof body.public === "boolean" ? body.public : undefined,
			file_size_limit: typeof body.file_size_limit === "number" ? body.file_size_limit : undefined,
			allowed_mime_types: Array.isArray(body.allowed_mime_types) ? body.allowed_mime_types as string[] : undefined,
		});
		return jsonResponse({ name: bucket.name }, 200);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to create bucket";
		if (message.includes("duplicate") || message.includes("unique")) {
			return errorResponse("Bucket already exists", 409);
		}
		return errorResponse(message, 500);
	}
}

async function handleUpdateBucket(
	id: string,
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);
	try {
		await handler.updateBucket(id, {
			public: typeof body.public === "boolean" ? body.public : undefined,
			file_size_limit: typeof body.file_size_limit === "number" ? body.file_size_limit : undefined,
			allowed_mime_types: Array.isArray(body.allowed_mime_types) ? body.allowed_mime_types as string[] : undefined,
		});
		return jsonResponse({ message: "Successfully updated" });
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to update bucket";
		return errorResponse(message, 404);
	}
}

async function handleEmptyBucket(
	id: string,
	handler: StorageHandler,
): Promise<Response> {
	try {
		await handler.emptyBucket(id);
		return jsonResponse({ message: "Successfully emptied" });
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to empty bucket";
		return errorResponse(message, 500);
	}
}

async function handleDeleteBucket(
	id: string,
	handler: StorageHandler,
): Promise<Response> {
	try {
		await handler.deleteBucket(id);
		return jsonResponse({ message: "Successfully deleted" });
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to delete bucket";
		if (message.includes("not empty")) {
			return errorResponse("Bucket not empty", 409);
		}
		return errorResponse(message, 500);
	}
}

// ─── Object Handlers ──────────────────────────────────────────────────

async function handleUpload(
	bucketId: string,
	objectPath: string,
	request: Request,
	handler: StorageHandler,
	opts: { ownerId: string | undefined; upsert: boolean },
): Promise<Response> {
	let upsert = opts.upsert;
	const xUpsert = request.headers.get("x-upsert");
	if (xUpsert === "true") upsert = true;

	const cacheControl = request.headers.get("cache-control") ?? undefined;

	try {
		const { data, contentType } = await readFileBody(request);

		const obj = await handler.uploadObject(
			bucketId,
			objectPath,
			data,
			contentType,
			{
				cacheControl,
				upsert,
				ownerId: opts.ownerId,
			},
		);

		return jsonResponse({
			Id: obj.id,
			Key: `${bucketId}/${objectPath}`,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Upload failed";
		if (
			message.includes("duplicate") ||
			message.includes("unique") ||
			message.includes("already exists")
		) {
			return errorResponse("The resource already exists", 409);
		}
		if (message.includes("File size") || message.includes("MIME type")) {
			return errorResponse(message, 422);
		}
		return errorResponse(message, 500);
	}
}

async function handleDownload(
	bucketId: string,
	objectPath: string,
	handler: StorageHandler,
): Promise<Response> {
	const result = await handler.downloadObject(bucketId, objectPath);
	if (!result) return errorResponse("Object not found", 404);

	return new Response(
		result.data.buffer.slice(
			result.data.byteOffset,
			result.data.byteOffset + result.data.byteLength,
		) as ArrayBuffer,
		{
			status: 200,
			headers: {
				"Content-Type": result.metadata.contentType,
				"Content-Length": result.metadata.size.toString(),
				"Cache-Control": result.metadata.cacheControl ?? "max-age=3600",
				ETag: (result.object.metadata as Record<string, string>)?.eTag ?? "",
			},
		},
	);
}

async function handleExists(
	bucketId: string,
	objectPath: string,
	handler: StorageHandler,
): Promise<Response> {
	const exists = await handler.objectExists(bucketId, objectPath);
	if (!exists) return new Response(null, { status: 404 });
	return new Response(null, { status: 200 });
}

async function handleRemoveObjects(
	bucketId: string,
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);
	const prefixes = Array.isArray(body.prefixes) ? body.prefixes as string[] : undefined;
	if (!prefixes) {
		return errorResponse("prefixes array is required");
	}

	const removed = await handler.removeObjects(bucketId, prefixes);
	return jsonResponse(removed);
}

async function handleListObjects(
	bucketId: string,
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);

	const objects = await handler.listObjects(bucketId, {
		prefix: typeof body.prefix === "string" ? body.prefix : undefined,
		limit: typeof body.limit === "number" ? body.limit : undefined,
		offset: typeof body.offset === "number" ? body.offset : undefined,
		sortBy: typeof body.sortBy === "object" && body.sortBy !== null ? body.sortBy as { column: string; order: string } : undefined,
		search: typeof body.search === "string" ? body.search : undefined,
	});

	const prefix = typeof body.prefix === "string" ? body.prefix : "";
	const items = objects.map((obj) => {
		const relativeName = obj.name.startsWith(prefix)
			? obj.name.slice(prefix.length)
			: obj.name;

		return {
			name: relativeName,
			id: obj.id,
			updated_at: obj.updated_at,
			created_at: obj.created_at,
			last_accessed_at: obj.last_accessed_at,
			metadata: obj.metadata,
		};
	});

	return jsonResponse(items);
}

async function handleMoveObject(
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);
	const bucketId = typeof body.bucketId === "string" ? body.bucketId : undefined;
	const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : undefined;
	const destinationKey = typeof body.destinationKey === "string" ? body.destinationKey : undefined;
	const destinationBucket = typeof body.destinationBucket === "string" ? body.destinationBucket : undefined;

	if (!bucketId || !sourceKey || !destinationKey) {
		return errorResponse(
			"bucketId, sourceKey, and destinationKey are required",
		);
	}

	try {
		await handler.moveObject(
			bucketId,
			sourceKey,
			destinationKey,
			destinationBucket,
		);
		return jsonResponse({ message: "Successfully moved" });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Move failed";
		return errorResponse(message, 500);
	}
}

async function handleCopyObject(
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);
	const bucketId = typeof body.bucketId === "string" ? body.bucketId : undefined;
	const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : undefined;
	const destinationKey = typeof body.destinationKey === "string" ? body.destinationKey : undefined;
	const destinationBucket = typeof body.destinationBucket === "string" ? body.destinationBucket : undefined;

	if (!bucketId || !sourceKey || !destinationKey) {
		return errorResponse(
			"bucketId, sourceKey, and destinationKey are required",
		);
	}

	try {
		const key = await handler.copyObject(
			bucketId,
			sourceKey,
			destinationKey,
			destinationBucket,
		);
		return jsonResponse({ Key: key });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Copy failed";
		return errorResponse(message, 500);
	}
}

async function handleCreateSignedUrl(
	bucketId: string,
	objectPath: string,
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);
	const expiresIn = (typeof body.expiresIn === "number" ? body.expiresIn : 3600);

	try {
		const token = await handler.createSignedUrl(
			bucketId,
			objectPath,
			expiresIn,
		);
		// Return the same format that supabase-js expects
		const signedUrl = `/object/sign/${bucketId}/${objectPath}?token=${token}`;
		return jsonResponse({ signedURL: signedUrl });
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to create signed URL";
		return errorResponse(message, 500);
	}
}

async function handleCreateSignedUrls(
	bucketId: string,
	request: Request,
	handler: StorageHandler,
): Promise<Response> {
	const body = await parseBody(request);
	const expiresIn = (typeof body.expiresIn === "number" ? body.expiresIn : 3600);
	const paths = Array.isArray(body.paths) ? body.paths as string[] : undefined;

	if (!paths) {
		return errorResponse("paths array is required");
	}

	const results = await Promise.all(
		paths.map(async (path) => {
			try {
				const token = await handler.createSignedUrl(bucketId, path, expiresIn);
				const signedUrl = `/object/sign/${bucketId}/${path}?token=${token}`;
				return { signedURL: signedUrl, path, error: null };
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed";
				return { signedURL: null, path, error: message };
			}
		}),
	);

	return jsonResponse(results);
}

async function handleSignedDownload(
	token: string,
	db: PGlite,
	handler: StorageHandler,
): Promise<Response> {
	// For signed downloads, we need to bypass RLS (use service role)
	await db.exec("RESET ROLE");

	const payload = await handler.verifySignedUrl(token);
	if (!payload) return errorResponse("Invalid or expired signed URL", 401);

	const result = await handler.downloadObject(
		payload.bucket_id,
		payload.object_name,
	);
	if (!result) return errorResponse("Object not found", 404);

	return new Response(
		result.data.buffer.slice(
			result.data.byteOffset,
			result.data.byteOffset + result.data.byteLength,
		) as ArrayBuffer,
		{
			status: 200,
			headers: {
				"Content-Type": result.metadata.contentType,
				"Content-Length": result.metadata.size.toString(),
				"Cache-Control": result.metadata.cacheControl ?? "max-age=3600",
			},
		},
	);
}

async function handlePublicDownload(
	bucketId: string,
	objectPath: string,
	db: PGlite,
	handler: StorageHandler,
): Promise<Response> {
	// Bypass RLS for public bucket access — verify bucket is public first
	await db.exec("RESET ROLE");

	const bucket = await handler.getBucket(bucketId);
	if (!bucket) return errorResponse("Bucket not found", 404);
	if (!bucket.public) return errorResponse("Bucket is not public", 400);

	const result = await handler.downloadObject(bucketId, objectPath);
	if (!result) return errorResponse("Object not found", 404);

	return new Response(
		result.data.buffer.slice(
			result.data.byteOffset,
			result.data.byteOffset + result.data.byteLength,
		) as ArrayBuffer,
		{
			status: 200,
			headers: {
				"Content-Type": result.metadata.contentType,
				"Content-Length": result.metadata.size.toString(),
				"Cache-Control": result.metadata.cacheControl ?? "max-age=3600",
			},
		},
	);
}

async function handleObjectInfo(
	bucketId: string,
	objectPath: string,
	handler: StorageHandler,
): Promise<Response> {
	const obj = await handler.getObjectInfo(bucketId, objectPath);
	if (!obj) return errorResponse("Object not found", 404);

	// Return camelized format matching supabase-js expectations
	return jsonResponse({
		id: obj.id,
		name: obj.name,
		bucketId: obj.bucket_id,
		owner: obj.owner_id,
		createdAt: obj.created_at,
		updatedAt: obj.updated_at,
		lastAccessedAt: obj.last_accessed_at,
		metadata: obj.metadata,
		userMetadata: obj.user_metadata,
		version: obj.version,
	});
}
