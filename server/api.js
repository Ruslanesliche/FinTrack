import { normalizeSnapshot } from "../js/validation.js";

const MAX_SNAPSHOT_BYTES = 1_500_000;

const CREATE_PROFILES_SQL = `
  CREATE TABLE IF NOT EXISTS fintrack_profiles_v2 (
    user_id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_SNAPSHOTS_SQL = `
  CREATE TABLE IF NOT EXISTS fintrack_snapshots_v2 (
    owner_user_id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    client_updated_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES fintrack_profiles_v2(user_id) ON DELETE CASCADE
  )
`;

const CREATE_UPDATED_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS fintrack_snapshots_v2_updated_at_idx
  ON fintrack_snapshots_v2(updated_at)
`;

const API_SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...API_SECURITY_HEADERS,
      ...headers,
    },
  });
}

function authConfig(env) {
  const url = env?.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = env?.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function plausibleAccessToken(token, config) {
  if (token.length < 100 || token.length > 8_192) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const encoded = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    return typeof payload?.sub === "string"
      && payload.sub.length > 10
      && payload.iss === `${config.url}/auth/v1`
      && Number(payload.exp || 0) > Math.floor(Date.now() / 1_000) - 60;
  } catch {
    return false;
  }
}

export async function getAuthenticatedUser(request, env) {
  const config = authConfig(env);
  const token = bearerToken(request);
  if (!config || !token || !plausibleAccessToken(token, config)) return null;

  const authFetch = env?.AUTH_FETCH || fetch;
  let response;
  try {
    response = await authFetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const identity = await response.json().catch(() => null);
  const email = identity?.email?.trim().toLowerCase();
  if (!identity?.id || !email || email.length > 254 || !email.includes("@")) return null;
  const rawName = identity.user_metadata?.full_name || identity.user_metadata?.name;
  const name = typeof rawName === "string" ? rawName.trim().slice(0, 120) || null : null;
  return { id: identity.id, email, name };
}

export function validateSnapshot(data) {
  return normalizeSnapshot(data) !== null;
}

async function ensureDatabase(env) {
  if (!env?.DB) {
    const error = new Error("Cloud storage is not configured.");
    error.status = 503;
    throw error;
  }
  await env.DB.batch([
    env.DB.prepare(CREATE_PROFILES_SQL),
    env.DB.prepare(CREATE_SNAPSHOTS_SQL),
    env.DB.prepare(CREATE_UPDATED_INDEX_SQL),
  ]);
}

async function loadSnapshot(db, userId) {
  const row = await db.prepare(`
    SELECT payload, revision, client_updated_at AS clientUpdatedAt, updated_at AS updatedAt
    FROM fintrack_snapshots_v2
    WHERE owner_user_id = ?
  `).bind(userId).first();

  if (!row) {
    return { data: null, revision: 0, clientUpdatedAt: null, updatedAt: null };
  }

  const data = JSON.parse(row.payload);
  const normalized = normalizeSnapshot(data);
  if (!normalized) {
    const error = new Error("The stored snapshot is invalid.");
    error.status = 500;
    throw error;
  }
  return {
    data: normalized,
    revision: Number(row.revision) || 0,
    clientUpdatedAt: row.clientUpdatedAt || null,
    updatedAt: row.updatedAt || null,
  };
}

async function saveSnapshot(db, user, data, expectedRevision, clientUpdatedAt) {
  const existing = await loadSnapshot(db, user.id);
  if (expectedRevision !== null && expectedRevision !== existing.revision) {
    return { conflict: true, snapshot: existing };
  }

  const revision = existing.revision + 1;
  const payload = JSON.stringify(data);
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(`
      INSERT INTO fintrack_profiles_v2 (user_id, email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).bind(user.id, user.email, user.name, now, now),
    db.prepare(`
      INSERT INTO fintrack_snapshots_v2 (
        owner_user_id, payload, revision, client_updated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_user_id) DO UPDATE SET
        payload = excluded.payload,
        revision = excluded.revision,
        client_updated_at = excluded.client_updated_at,
        updated_at = excluded.updated_at
    `).bind(user.id, payload, revision, clientUpdatedAt, now),
  ]);

  return {
    conflict: false,
    snapshot: { data, revision, clientUpdatedAt, updatedAt: now },
  };
}

function sameOriginWrite(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/auth/config" && request.method === "GET") {
    const config = authConfig(env);
    return config
      ? json(config)
      : json({ error: "auth_not_configured" }, 503);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...API_SECURITY_HEADERS, allow: "GET, PUT, DELETE, OPTIONS" },
    });
  }

  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return json({ error: "authentication_required" }, 401);
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    return json({ authenticated: true, user });
  }

  try {
    await ensureDatabase(env);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, storage: "ready" });
    }

    if (url.pathname !== "/api/sync") {
      return json({ error: "not_found" }, 404);
    }

    if (request.method === "GET") {
      return json(await loadSnapshot(env.DB, user.id));
    }

    if (!sameOriginWrite(request)) {
      return json({ error: "origin_mismatch" }, 403);
    }

    if (request.method === "PUT") {
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return json({ error: "unsupported_media_type" }, 415);
      }

      const contentLength = Number(request.headers.get("content-length")) || 0;
      if (contentLength > MAX_SNAPSHOT_BYTES) {
        return json({ error: "snapshot_too_large" }, 413);
      }

      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) {
        return json({ error: "snapshot_too_large" }, 413);
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      const normalized = normalizeSnapshot(body.data);
      if (!normalized) {
        return json({ error: "invalid_snapshot" }, 400);
      }

      if (
        body.expectedRevision != null
        && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
      ) {
        return json({ error: "invalid_revision" }, 400);
      }
      const expectedRevision = body.expectedRevision ?? null;
      const clientUpdatedAt = typeof body.clientUpdatedAt === "string"
        ? body.clientUpdatedAt.slice(0, 40)
        : null;
      const result = await saveSnapshot(
        env.DB,
        user,
        normalized,
        expectedRevision,
        clientUpdatedAt,
      );

      if (result.conflict) {
        return json({ error: "sync_conflict", ...result.snapshot }, 409);
      }
      return json(result.snapshot);
    }

    if (request.method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM fintrack_snapshots_v2 WHERE owner_user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM fintrack_profiles_v2 WHERE user_id = ?").bind(user.id),
      ]);
      return new Response(null, {
        status: 204,
        headers: { ...API_SECURITY_HEADERS, "cache-control": "no-store" },
      });
    }

    return json({ error: "method_not_allowed" }, 405, {
      allow: "GET, PUT, DELETE, OPTIONS",
    });
  } catch (error) {
    return json(
      { error: error?.status === 503 ? "storage_unavailable" : "server_error" },
      Number(error?.status) || 500,
    );
  }
}
