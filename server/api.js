const MAX_SNAPSHOT_BYTES = 1_500_000;
const ARRAY_STORES = ["accounts", "transactions", "categories", "budgets", "goals", "debts", "recurring"];

const CREATE_PROFILES_SQL = `
  CREATE TABLE IF NOT EXISTS fintrack_profiles (
    email TEXT PRIMARY KEY NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_SNAPSHOTS_SQL = `
  CREATE TABLE IF NOT EXISTS fintrack_snapshots (
    owner_email TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    client_updated_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_email) REFERENCES fintrack_profiles(email) ON DELETE CASCADE
  )
`;

const CREATE_UPDATED_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS fintrack_snapshots_updated_at_idx
  ON fintrack_snapshots(updated_at)
`;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function decodeDisplayName(request) {
  const value = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  if (!value || encoding !== "percent-encoded-utf-8") return null;
  try {
    return decodeURIComponent(value).trim().slice(0, 120) || null;
  } catch {
    return null;
  }
}

export function getAuthenticatedUser(request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) return null;
  return { email, name: decodeDisplayName(request) };
}

export function validateSnapshot(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) return false;
  if (data.appState != null && (typeof data.appState !== "object" || Array.isArray(data.appState))) return false;
  return ARRAY_STORES.every((store) => Array.isArray(data[store]));
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

async function loadSnapshot(db, email) {
  const row = await db.prepare(`
    SELECT payload, revision, client_updated_at AS clientUpdatedAt, updated_at AS updatedAt
    FROM fintrack_snapshots
    WHERE owner_email = ?
  `).bind(email).first();

  if (!row) {
    return { data: null, revision: 0, clientUpdatedAt: null, updatedAt: null };
  }

  try {
    return {
      data: JSON.parse(row.payload),
      revision: Number(row.revision) || 0,
      clientUpdatedAt: row.clientUpdatedAt || null,
      updatedAt: row.updatedAt || null,
    };
  } catch {
    const error = new Error("The stored snapshot is unreadable.");
    error.status = 500;
    throw error;
  }
}

async function saveSnapshot(db, user, data, expectedRevision, clientUpdatedAt) {
  const existing = await loadSnapshot(db, user.email);
  if (expectedRevision !== null && expectedRevision !== existing.revision) {
    return { conflict: true, snapshot: existing };
  }

  const revision = existing.revision + 1;
  const payload = JSON.stringify(data);
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(`
      INSERT INTO fintrack_profiles (email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).bind(user.email, user.name, now, now),
    db.prepare(`
      INSERT INTO fintrack_snapshots (
        owner_email, payload, revision, client_updated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_email) DO UPDATE SET
        payload = excluded.payload,
        revision = excluded.revision,
        client_updated_at = excluded.client_updated_at,
        updated_at = excluded.updated_at
    `).bind(user.email, payload, revision, clientUpdatedAt, now),
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

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { allow: "GET, PUT, DELETE, OPTIONS" },
    });
  }

  const user = getAuthenticatedUser(request);
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
      return json(await loadSnapshot(env.DB, user.email));
    }

    if (!sameOriginWrite(request)) {
      return json({ error: "origin_mismatch" }, 403);
    }

    if (request.method === "PUT") {
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

      if (!validateSnapshot(body.data)) {
        return json({ error: "invalid_snapshot" }, 400);
      }

      const expectedRevision = body.expectedRevision == null
        ? null
        : Math.max(0, Number.parseInt(body.expectedRevision, 10) || 0);
      const clientUpdatedAt = typeof body.clientUpdatedAt === "string"
        ? body.clientUpdatedAt.slice(0, 40)
        : null;
      const result = await saveSnapshot(
        env.DB,
        user,
        body.data,
        expectedRevision,
        clientUpdatedAt,
      );

      if (result.conflict) {
        return json({ error: "sync_conflict", ...result.snapshot }, 409);
      }
      return json(result.snapshot);
    }

    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM fintrack_snapshots WHERE owner_email = ?")
        .bind(user.email)
        .run();
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
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
