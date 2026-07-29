const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Milk-Village-Admin-Key",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/health" && request.method === "GET") {
        return json({ ok: true, service: "milk-village-api" });
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
  const row = await env.DB.prepare("select id, data, updated_at from milk_village_state where id = ?").bind(stateId).first();
  if (!row) return json({ error: "state_not_found" }, { status: 404 });
  if (metaOnly) return json({ id: row.id, updated_at: row.updated_at });
  return json({
    id: row.id,
    data: parseStateData(row.data),
    updated_at: row.updated_at,
  });
}

async function handlePutState(request, env, stateId) {
  const body = await request.json();
  if (!body || typeof body !== "object" || !body.data) {
    return json({ error: "invalid_state_payload" }, { status: 400 });
  }

  const updatedAt = normalizeIso(body.updated_at) || new Date().toISOString();
  await env.DB.prepare(
    `insert into milk_village_state (id, data, updated_at)
     values (?, ?, ?)
     on conflict(id) do update set data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(stateId, JSON.stringify(body.data), updatedAt)
    .run();

  return json({ id: stateId, updated_at: updatedAt });
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

