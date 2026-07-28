import test from "node:test";
import assert from "node:assert/strict";

import {
  getAuthenticatedUser,
  handleApiRequest,
  validateSnapshot,
} from "../server/api.js";
import { normalizeSnapshot } from "../js/validation.js";

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const validToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
  sub: "user-12345678",
  iss: "https://project.supabase.co/auth/v1",
  exp: Math.floor(Date.now() / 1_000) + 3_600,
  role: "authenticated",
})}.${"s".repeat(48)}`;

const validSnapshot = {
  app: "FinTrack",
  version: 1,
  settings: { currency: "KZT" },
  appState: {},
  accounts: [],
  transactions: [],
  categories: [],
  budgets: [],
  goals: [],
  debts: [],
  recurring: [],
};

class MemoryStatement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new MemoryStatement(this.database, this.sql, bindings);
  }

  async first() {
    if (!this.sql.includes("FROM fintrack_snapshots")) return null;
    const row = this.database.snapshots.get(this.bindings[0]);
    return row ? { ...row } : null;
  }

  async run() {
    if (this.sql.includes("DELETE FROM fintrack_snapshots")) {
      this.database.snapshots.delete(this.bindings[0]);
    }
    return { success: true };
  }
}

class MemoryDatabase {
  constructor() {
    this.snapshots = new Map();
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) {
      if (statement.sql.includes("INSERT INTO fintrack_snapshots_v2")) {
        const [ownerUserId, payload, revision, clientUpdatedAt, updatedAt] = statement.bindings;
        this.snapshots.set(ownerUserId, {
          payload,
          revision,
          clientUpdatedAt,
          updatedAt,
        });
      }
    }
    return statements.map(() => ({ success: true }));
  }
}

function environment(database) {
  return {
    ...(database ? { DB: database } : {}),
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    AUTH_FETCH: async (_url, options) => {
      if (options.headers.authorization !== `Bearer ${validToken}`) {
        return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
      }
      return Response.json({
        id: "user-12345678",
        email: "Ruslan@Example.com",
        user_metadata: { full_name: "Руслан" },
      });
    },
  };
}

const authorization = { authorization: `Bearer ${validToken}` };

test("validates complete FinTrack snapshots", () => {
  assert.equal(validateSnapshot(validSnapshot), true);
  assert.equal(validateSnapshot({ ...validSnapshot, transactions: null }), false);
  assert.equal(validateSnapshot({ ...validSnapshot, settings: [] }), false);
});

test("validates a Supabase access token and normalizes its user", async () => {
  const request = new Request("https://fintrack.example/api/session", {
    headers: authorization,
  });
  assert.deepEqual(await getAuthenticatedUser(request, environment()), {
    id: "user-12345678",
    email: "ruslan@example.com",
    name: "Руслан",
  });
});

test("rejects unauthenticated API requests before database access", async () => {
  const response = await handleApiRequest(
    new Request("https://fintrack.example/api/sync"),
    environment(),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});

test("serves the public browser auth configuration", async () => {
  const response = await handleApiRequest(
    new Request("https://fintrack.example/api/auth/config"),
    environment(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_test",
  });
});

test("returns the authenticated session without requiring storage", async () => {
  const response = await handleApiRequest(
    new Request("https://fintrack.example/api/session", {
      headers: authorization,
    }),
    environment(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    user: {
      id: "user-12345678",
      email: "ruslan@example.com",
      name: "Руслан",
    },
  });
});

test("stores, loads, and conflict-checks an authenticated snapshot", async () => {
  const database = new MemoryDatabase();
  const headers = {
    "content-type": "application/json",
    origin: "https://fintrack.example",
    ...authorization,
  };

  const saved = await handleApiRequest(
    new Request("https://fintrack.example/api/sync", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        data: validSnapshot,
        expectedRevision: 0,
        clientUpdatedAt: "2026-07-26T10:00:00.000Z",
      }),
    }),
    environment(database),
  );
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);

  const loaded = await handleApiRequest(
    new Request("https://fintrack.example/api/sync", {
      headers: authorization,
    }),
    environment(database),
  );
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).data, normalizeSnapshot(validSnapshot));

  const conflict = await handleApiRequest(
    new Request("https://fintrack.example/api/sync", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        data: validSnapshot,
        expectedRevision: 0,
      }),
    }),
    environment(database),
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "sync_conflict");
});

test("rejects malformed JWTs without calling the identity provider", async () => {
  let called = false;
  const response = await handleApiRequest(
    new Request("https://fintrack.example/api/session", {
      headers: { authorization: "Bearer not-a-jwt" },
    }),
    {
      ...environment(),
      AUTH_FETCH: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
    },
  );
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("rejects cross-origin writes and unsupported content types", async () => {
  const database = new MemoryDatabase();
  const crossOrigin = await handleApiRequest(
    new Request("https://fintrack.example/api/sync", {
      method: "PUT",
      headers: {
        ...authorization,
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ data: validSnapshot }),
    }),
    environment(database),
  );
  assert.equal(crossOrigin.status, 403);

  const wrongType = await handleApiRequest(
    new Request("https://fintrack.example/api/sync", {
      method: "PUT",
      headers: { ...authorization, origin: "https://fintrack.example" },
      body: JSON.stringify({ data: validSnapshot }),
    }),
    environment(database),
  );
  assert.equal(wrongType.status, 415);
});
