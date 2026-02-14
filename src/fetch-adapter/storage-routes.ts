/**
 * Storage routes handler — processes /storage/v1/* requests
 *
 * Intercepts supabase-js storage client calls and handles them locally:
 *   /storage/v1/bucket/*        → bucket CRUD
 *   /storage/v1/object/*        → object upload/download/list/move/copy/remove
 *   /storage/v1/object/sign/*   → signed URL creation & download
 *   /storage/v1/object/public/* → public file download
 *   /storage/v1/object/info/*   → object metadata
 *   /storage/v1/render/*        → image transform (returns original)
 */

import type { PGlite } from "@electric-sql/pglite";
import type { StorageHandler } from "../storage/handler.ts";
import { setAuthContext } from "./auth-context.ts";

// ─── Helpers ──────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse(
    { statusCode: status.toString(), error: message, message },
    status,
  );
}

function extractBearerToken(headers: Headers): string | null {
  const auth = headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

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
    contentType:
      requestContentType || "application/octet-stream",
  };
}

// ─── Main Router ──────────────────────────────────────────────────────

export async function handleStorageRoute(
  request: Request,
  pathname: string,
  db: PGlite,
  storageHandler: StorageHandler,
): Promise<Response> {
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

    // POST /storage/v1/object/sign/:bucketId/:path — create signed URL
    const signMatch = pathname.match(
      /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/,
    );
    if (signMatch && method === "POST") {
      return await handleCreateSignedUrl(
        signMatch[1]!,
        signMatch[2]!,
        request,
        storageHandler,
      );
    }

    // POST /storage/v1/object/sign/:bucketId — create signed URLs (batch)
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

    // GET /storage/v1/object/sign/:token — download via signed URL
    // The signed URL format from supabase-js is /storage/v1/object/sign/:bucketId/:path?token=<token>
    const signedDownloadMatch = pathname.match(
      /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/,
    );
    if (signedDownloadMatch && method === "GET") {
      const url = new URL(request.url);
      const signedToken = url.searchParams.get("token");
      if (signedToken) {
        return await handleSignedDownload(signedToken, db, storageHandler);
      }
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
    const listMatch = pathname.match(
      /^\/storage\/v1\/object\/list\/([^/]+)$/,
    );
    if (listMatch && method === "POST") {
      return await handleListObjects(
        listMatch[1]!,
        request,
        storageHandler,
      );
    }

    // DELETE /storage/v1/object/:bucketId — remove objects (batch)
    const removeMatch = pathname.match(
      /^\/storage\/v1\/object\/([^/]+)$/,
    );
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
        authCtx.userId,
        false,
      );
    }

    // PUT /storage/v1/object/:bucketId/:path — update (upsert)
    if (uploadMatch && method === "PUT") {
      return await handleUpload(
        uploadMatch[1]!,
        uploadMatch[2]!,
        request,
        storageHandler,
        authCtx.userId,
        true,
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

    return errorResponse("Storage endpoint not found", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500);
  }
}

// ─── Bucket Handlers ──────────────────────────────────────────────────

async function handleListBuckets(
  handler: StorageHandler,
): Promise<Response> {
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
  const body = await parseJsonBody(request);
  const name = (body.name ?? body.id) as string;
  if (!name) return errorResponse("Bucket name is required");

  try {
    const bucket = await handler.createBucket({
      id: (body.id as string) ?? name,
      name,
      public: body.public as boolean | undefined,
      file_size_limit: body.file_size_limit as number | undefined,
      allowed_mime_types: body.allowed_mime_types as string[] | undefined,
    });
    return jsonResponse({ name: bucket.name }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create bucket";
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
  const body = await parseJsonBody(request);
  try {
    await handler.updateBucket(id, {
      public: body.public as boolean | undefined,
      file_size_limit: body.file_size_limit as number | undefined,
      allowed_mime_types: body.allowed_mime_types as string[] | undefined,
    });
    return jsonResponse({ message: "Successfully updated" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update bucket";
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
    const message = err instanceof Error ? err.message : "Failed to empty bucket";
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
    const message = err instanceof Error ? err.message : "Failed to delete bucket";
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
  ownerId: string | undefined,
  upsert: boolean,
): Promise<Response> {
  // x-upsert header can also control upsert behavior
  const xUpsert = request.headers.get("x-upsert");
  if (xUpsert === "true") upsert = true;

  const cacheControl = request.headers.get("cache-control") ?? undefined;

  try {
    const { data, contentType } = await readFileBody(request);

    const obj = await handler.uploadObject(bucketId, objectPath, data, contentType, {
      cacheControl,
      upsert,
      ownerId,
    });

    return jsonResponse({
      Id: obj.id,
      Key: `${bucketId}/${objectPath}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    if (message.includes("duplicate") || message.includes("unique") || message.includes("already exists")) {
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

  return new Response(result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength) as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": result.metadata.contentType,
      "Content-Length": result.metadata.size.toString(),
      "Cache-Control": result.metadata.cacheControl ?? "max-age=3600",
      "ETag":
        (result.object.metadata as Record<string, string>)?.eTag ?? "",
    },
  });
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
  const body = await parseJsonBody(request);
  const prefixes = body.prefixes as string[] | undefined;
  if (!prefixes || !Array.isArray(prefixes)) {
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
  const body = await parseJsonBody(request);

  const objects = await handler.listObjects(bucketId, {
    prefix: body.prefix as string | undefined,
    limit: body.limit as number | undefined,
    offset: body.offset as number | undefined,
    sortBy: body.sortBy as
      | { column: string; order: string }
      | undefined,
    search: body.search as string | undefined,
  });

  // Transform to match Supabase Storage API response format
  const prefix = (body.prefix as string) ?? "";
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
  const body = await parseJsonBody(request);
  const bucketId = body.bucketId as string;
  const sourceKey = body.sourceKey as string;
  const destinationKey = body.destinationKey as string;
  const destinationBucket = body.destinationBucket as string | undefined;

  if (!bucketId || !sourceKey || !destinationKey) {
    return errorResponse("bucketId, sourceKey, and destinationKey are required");
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
  const body = await parseJsonBody(request);
  const bucketId = body.bucketId as string;
  const sourceKey = body.sourceKey as string;
  const destinationKey = body.destinationKey as string;
  const destinationBucket = body.destinationBucket as string | undefined;

  if (!bucketId || !sourceKey || !destinationKey) {
    return errorResponse("bucketId, sourceKey, and destinationKey are required");
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
  const body = await parseJsonBody(request);
  const expiresIn = (body.expiresIn as number) ?? 3600;

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
    const message = err instanceof Error ? err.message : "Failed to create signed URL";
    return errorResponse(message, 500);
  }
}

async function handleCreateSignedUrls(
  bucketId: string,
  request: Request,
  handler: StorageHandler,
): Promise<Response> {
  const body = await parseJsonBody(request);
  const expiresIn = (body.expiresIn as number) ?? 3600;
  const paths = body.paths as string[] | undefined;

  if (!paths || !Array.isArray(paths)) {
    return errorResponse("paths array is required");
  }

  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        const token = await handler.createSignedUrl(
          bucketId,
          path,
          expiresIn,
        );
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

  return new Response(result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength) as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": result.metadata.contentType,
      "Content-Length": result.metadata.size.toString(),
      "Cache-Control": result.metadata.cacheControl ?? "max-age=3600",
    },
  });
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

  return new Response(result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength) as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": result.metadata.contentType,
      "Content-Length": result.metadata.size.toString(),
      "Cache-Control": result.metadata.cacheControl ?? "max-age=3600",
    },
  });
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
