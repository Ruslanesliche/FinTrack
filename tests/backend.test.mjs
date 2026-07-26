import test from "node:test";
import assert from "node:assert/strict";

import {
  getAuthenticatedUser,
  handleApiRequest,
  validateSnapshot,
} from "../server/api.js";

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
      if (statement.sql.includes("INSERT INTO fintrack_snapshots")) {
        const [ownerEmail, payload, revision, clientUpdatedAt, updatedAt] = statement.bindings;
        this.snapshots.set(ownerEmail, {
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

test("validates complete FinTrack snapshots", () => {
  assert.equal(validateSnapshot(validSnapshot), true);
  assert.equal(validateSnapshot({ ...validSnapshot, transactions: null }), false);
  assert.equal(validateSnapshot({ ...validSnapshot, settings: [] }), false);
});

test("reads and normalizes the authenticated Sites user", () => {
  const request = new Request("https://fintrack.example/api/session", {
    headers: {
      "oai-authenticated-user-email": " Ruslan@Example.com ",
      "oai-authenticated-user-full-name": "%D0%A0%D1%83%D1%81%D0%BB%D0%B0%D0%BD",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });
  assert.deepEqual(getAuthenticatedUser(request), {
    email: "ruslan@example.com",
    name: "Руслан",
  });
});

test("rejects unauthenticated API requests before database access", async () => {
  const response = await handleApiRequest(
    new Request("https://fintrack.example/api/sync"),
    {},
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});

test("returns the authenticated session without requiring storage", async () => {
  const response = await handleApiRequest(
    new Request("https://fintrack.example/api/session", {
      headers: { "oai-authenticated-user-email": "ruslan@example.com" },
    }),
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    user: { email: "ruslan@example.com", name: null },
  });
});

test("stores, loads, and conflict-checks an authenticated snapshot", async () => {
  const database = new MemoryDatabase();
  const headers = {
    "content-type": "application/json",
    origin: "https://fintrack.example",
    "oai-authenticated-user-email": "ruslan@example.com",
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
    { DB: database },
  );
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);

  const loaded = await handleApiRequest(
    new Request("https://fintrack.example/api/sync", {
      headers: { "oai-authenticated-user-email": "ruslan@example.com" },
    }),
    { DB: database },
  );
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).data, validSnapshot);

  const conflict = await handleApiRequest(
    new Request("https://fintrack.example/api/sync", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        data: validSnapshot,
        expectedRevision: 0,
      }),
    }),
    { DB: database },
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "sync_conflict");
});
