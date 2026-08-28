const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Milk-Village-Admin-Key",
  "Access-Control-Max-Age": "86400",
};
const CHUNKED_STATE_MARKER = "milk_village_chunked_state_v1";
const CHUNKED_STATE_POINTER_MARKER = "milk_village_chunked_state_v2";
const CHUNK_STORAGE_MARKER = "milk_village_chunk_storage_v1";
const STATE_CHUNK_SIZE = 128 * 1024;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/health" && request.method === "GET") {
        return json({ ok: true, service: "milk-village-api" });
      }

      const stateChunkMatch = path.match(/^\/state\/([^/]+)\/chunks\/([^/]+)(?:\/([^/]+))?$/);
      if (stateChunkMatch) {
        const stateId = decodeURIComponent(stateChunkMatch[1]);
        const uploadId = decodeURIComponent(stateChunkMatch[2]);
        const chunkPart = stateChunkMatch[3] ? decodeURIComponent(stateChunkMatch[3]) : "";
        if (request.method === "PUT" && /^\d+$/.test(chunkPart)) {
          return handlePutStateChunk(request, env, stateId, uploadId, Number(chunkPart));
        }
        if (request.method === "POST" && chunkPart === "commit") {
          return handleCommitStateChunks(request, env, stateId, uploadId);
        }
        if (request.method === "DELETE" && !chunkPart) {
          return handleDeleteStateChunkUpload(env, stateId, uploadId);
        }
      }

      const stateMatch = path.match(/^\/state\/([^/]+)(?:\/(meta))?$/);
      if (stateMatch) {
        const stateId = decodeURIComponent(stateMatch[1]);
        const isMeta = stateMatch[2] === "meta";
        if (request.method === "GET") return handleGetState(env, stateId, { metaOnly: isMeta });
        if (!isMeta && request.method === "PUT") return handlePutState(request, env, stateId);
      }

      const soundMatch = path.match(/^\/sounds\/(.+)$/);
      if (soundMatch) {
        const objectName = decodeURIComponent(soundMatch[1]);
        if (request.method === "GET") return handleGetSound(env, objectName);
        if (request.method === "PUT") return handlePutSound(request, env, objectName);
        if (request.method === "DELETE") return handleDeleteSound(request, env, objectName);
      }

      return json({ error: "not_found" }, { status: 404 });
    } catch (error) {
      return json({ error: "server_error", message: error?.message || String(error) }, { status: 500 });
    }
  },
};

async function handleGetState(env, stateId, { metaOnly = false } = {}) {
  const sql = metaOnly
    ? "select id, updated_at from milk_village_state where id = ?"
    : "select id, data, updated_at from milk_village_state where id = ?";
  const row = await env.DB.prepare(sql).bind(stateId).first();
  if (!row) return json({ error: "state_not_found" }, { status: 404 });
  if (metaOnly) return json({ id: row.id, updated_at: row.updated_at });
  const data = await readStateData(env, row);
  return json({
    id: row.id,
    data,
    updated_at: row.updated_at,
  });
}

async function handlePutState(request, env, stateId) {
  const body = await request.json();
  if (!body || typeof body !== "object" || !body.data) {
    return json({ error: "invalid_state_payload" }, { status: 400 });
  }

  const updatedAt = normalizeIso(body.updated_at) || new Date().toISOString();
  const serialized = JSON.stringify(body.data);
  const chunks = splitStateData(serialized);

  const previousRow = await env.DB.prepare("select data from milk_village_state where id = ?").bind(stateId).first();
  const previousData = parseStateData(previousRow?.data);
  const previousChunkStateIds = collectPreviousChunkStateIds(stateId, previousData);

  if (chunks.length > 1) {
    await writeChunkedState(env, stateId, chunks, serialized.length, updatedAt);
  } else {
    await upsertStateRow(env, stateId, serialized, updatedAt);
  }
  try {
    await cleanupPreviousChunkStateIds(env, stateId, previousChunkStateIds);
  } catch (error) {
    console.warn("state chunk cleanup failed", error);
  }

  return json({ id: stateId, updated_at: updatedAt });
}

async function handlePutStateChunk(request, env, stateId, uploadId, chunkIndex) {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return json({ error: "invalid_chunk_index" }, { status: 400 });
  }

  const upload = parseChunkUploadParams(new URL(request.url));
  if (!upload) return json({ error: "invalid_chunk_upload" }, { status: 400 });
  if (chunkIndex >= upload.chunks) return json({ error: "chunk_index_out_of_range" }, { status: 400 });

  const chunkStateId = makeUploadChunkStateId(stateId, uploadId);
  const chunkStorageData = JSON.stringify({
    __type: CHUNK_STORAGE_MARKER,
    parent: stateId,
    uploadId,
    chunks: upload.chunks,
    bytes: upload.bytes,
    updated_at: upload.updatedAt,
  });
  const chunkText = await request.text();

  await upsertStateRow(env, chunkStateId, chunkStorageData, upload.updatedAt);
  await env.DB.prepare(
    `insert into milk_village_state_chunks (state_id, chunk_index, data_chunk)
     values (?, ?, ?)
     on conflict(state_id, chunk_index) do update set data_chunk = excluded.data_chunk`,
  )
    .bind(chunkStateId, chunkIndex, chunkText)
    .run();

  return json({ ok: true, id: stateId, uploadId, chunkIndex });
}

async function handleCommitStateChunks(request, env, stateId, uploadId) {
  const url = new URL(request.url);
  let body = null;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const upload = parseChunkUploadParams(url, body);
  if (!upload) return json({ error: "invalid_chunk_upload" }, { status: 400 });

  const chunkStateId = makeUploadChunkStateId(stateId, uploadId);
  const chunkRows = await env.DB.prepare(
    `select count(*) as chunk_count
     from milk_village_state_chunks
     where state_id = ?`,
  )
    .bind(chunkStateId)
    .first();
  if (Number(chunkRows?.chunk_count || 0) !== upload.chunks) {
    return json({ error: "incomplete_chunk_upload", expected: upload.chunks, received: Number(chunkRows?.chunk_count || 0) }, { status: 409 });
  }

  const previousRow = await env.DB.prepare("select data from milk_village_state where id = ?").bind(stateId).first();
  const previousData = parseStateData(previousRow?.data);
  const previousChunkStateIds = collectPreviousChunkStateIds(stateId, previousData).filter((id) => id !== chunkStateId);

  const stateData = JSON.stringify({
    __type: CHUNKED_STATE_POINTER_MARKER,
    chunkStateId,
    chunks: upload.chunks,
    bytes: upload.bytes,
  });
  await upsertStateRow(env, stateId, stateData, upload.updatedAt);

  try {
    await cleanupPreviousChunkStateIds(env, stateId, previousChunkStateIds);
  } catch (error) {
    console.warn("state chunk cleanup failed", error);
  }

  return json({ id: stateId, updated_at: upload.updatedAt, chunks: upload.chunks });
}

async function handleDeleteStateChunkUpload(env, stateId, uploadId) {
  await cleanupChunkStorage(env, makeUploadChunkStateId(stateId, uploadId));
  return json({ ok: true, id: stateId, uploadId });
}

async function readStateData(env, row) {
  const parsed = parseStateData(row.data);
  if (!isChunkedStateReference(parsed)) return parsed;
  const chunkStateId = getChunkStateId(row.id, parsed);

  const result = await env.DB.prepare(
    `select chunk_index, data_chunk
     from milk_village_state_chunks
     where state_id = ?
     order by chunk_index asc`,
  )
    .bind(chunkStateId)
    .all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  if (rows.length !== parsed.chunks) {
    throw new Error(`chunked state is incomplete: expected ${parsed.chunks}, got ${rows.length}`);
  }
  return parseStateData(rows.map((chunk) => chunk.data_chunk || "").join(""));
}

function isChunkedStateReference(value) {
  return (
    value?.__type === CHUNKED_STATE_MARKER ||
    value?.__type === CHUNKED_STATE_POINTER_MARKER
  ) && Number.isInteger(value.chunks) && value.chunks > 0;
}

function getChunkStateId(stateId, value) {
  if (value?.__type === CHUNKED_STATE_POINTER_MARKER && value.chunkStateId) return String(value.chunkStateId);
  return stateId;
}

async function writeChunkedState(env, stateId, chunks, byteLength, updatedAt) {
  const chunkStateId = makeChunkStateId(stateId);
  const chunkStorageData = JSON.stringify({
    __type: CHUNK_STORAGE_MARKER,
    parent: stateId,
    chunks: chunks.length,
    bytes: byteLength,
    updated_at: updatedAt,
  });
  const stateData = JSON.stringify({
    __type: CHUNKED_STATE_POINTER_MARKER,
    chunkStateId,
    chunks: chunks.length,
    bytes: byteLength,
  });

  try {
    const statements = [
      prepareUpsertStateRow(env, chunkStateId, chunkStorageData, updatedAt),
      ...chunks.map((chunk, index) =>
        env.DB.prepare(
          `insert into milk_village_state_chunks (state_id, chunk_index, data_chunk)
           values (?, ?, ?)`,
        ).bind(chunkStateId, index, chunk),
      ),
      prepareUpsertStateRow(env, stateId, stateData, updatedAt),
    ];
    await env.DB.batch(statements);
  } catch (error) {
    await cleanupChunkStorage(env, chunkStateId);
    throw error;
  }
}

function prepareUpsertStateRow(env, stateId, stateData, updatedAt) {
  return env.DB.prepare(
    `insert into milk_village_state (id, data, updated_at)
     values (?, ?, ?)
     on conflict(id) do update set data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(stateId, stateData, updatedAt);
}

async function upsertStateRow(env, stateId, stateData, updatedAt) {
  await prepareUpsertStateRow(env, stateId, stateData, updatedAt).run();
}

function makeChunkStateId(stateId) {
  const randomId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${stateId}__chunks__${Date.now()}__${randomId}`;
}

function makeUploadChunkStateId(stateId, uploadId) {
  return `${stateId}__chunks__upload__${uploadId}`;
}

function parseChunkUploadParams(url, body = {}) {
  const chunks = normalizePositiveInteger(body.chunks ?? url.searchParams.get("chunks"));
  const bytes = normalizePositiveInteger(body.bytes ?? url.searchParams.get("bytes"));
  const updatedAt = normalizeIso(body.updated_at || body.updatedAt || url.searchParams.get("updated_at")) || new Date().toISOString();
  if (!chunks || !bytes) return null;
  return { chunks, bytes, updatedAt };
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function collectPreviousChunkStateIds(stateId, previousData) {
  if (!isChunkedStateReference(previousData)) return [];
  return [getChunkStateId(stateId, previousData)];
}

async function cleanupPreviousChunkStateIds(env, stateId, chunkStateIds) {
  for (const chunkStateId of chunkStateIds) {
    if (!chunkStateId) continue;
    if (chunkStateId === stateId) {
      await env.DB.prepare("delete from milk_village_state_chunks where state_id = ?").bind(stateId).run();
    } else {
      await cleanupChunkStorage(env, chunkStateId);
    }
  }
}

async function cleanupChunkStorage(env, chunkStateId) {
  await env.DB.prepare("delete from milk_village_state_chunks where state_id = ?").bind(chunkStateId).run();
  await env.DB.prepare("delete from milk_village_state where id = ?").bind(chunkStateId).run();
}

function splitStateData(serialized) {
  if (serialized.length <= STATE_CHUNK_SIZE) return [serialized];
  const chunks = [];
  for (let index = 0; index < serialized.length; index += STATE_CHUNK_SIZE) {
    chunks.push(serialized.slice(index, index + STATE_CHUNK_SIZE));
  }
  return chunks;
}

async function handleGetSound(env, objectName) {
  const object = await env.ALARM_SOUNDS.get(objectName);
  if (!object) return json({ error: "sound_not_found" }, { status: 404 });

  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", object.httpMetadata?.contentType || "audio/mpeg");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

async function handlePutSound(request, env, objectName) {
  const authResponse = requireAdminKey(request, env);
  if (authResponse) return authResponse;

  await env.ALARM_SOUNDS.put(objectName, request.body, {
    httpMetadata: { contentType: request.headers.get("Content-Type") || "audio/mpeg" },
  });
  return json({ ok: true, objectName });
}

async function handleDeleteSound(request, env, objectName) {
  const authResponse = requireAdminKey(request, env);
  if (authResponse) return authResponse;

  await env.ALARM_SOUNDS.delete(objectName);
  return json({ ok: true, objectName });
}

function requireAdminKey(request, env) {
  const expected = String(env.ADMIN_SYNC_KEY || "").trim();
  if (!expected) return null;
  const actual = String(request.headers.get("X-Milk-Village-Admin-Key") || "").trim();
  if (actual === expected) return null;
  return json({ error: "unauthorized" }, { status: 401 });
}

function parseStateData(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeIso(value) {
  const text = String(value || "");
  return Number.isFinite(new Date(text).getTime()) ? text : "";
}

function json(value, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  Object.entries(CORS_HEADERS).forEach(([key, headerValue]) => headers.set(key, headerValue));
  return new Response(JSON.stringify(value), { ...init, headers });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
