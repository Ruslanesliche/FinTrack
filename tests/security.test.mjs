import test from "node:test";
import assert from "node:assert/strict";

import { safeSpreadsheetCell } from "../js/backup.js";
import { bindStorageToUser } from "../js/storage.js";
import { normalizeSnapshot } from "../js/validation.js";

const snapshot = {
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

test("neutralizes spreadsheet formulas in CSV cells", () => {
  assert.equal(safeSpreadsheetCell("=HYPERLINK(\"https://evil.example\")"), "'=HYPERLINK(\"https://evil.example\")");
  assert.equal(safeSpreadsheetCell("  +SUM(1,2)"), "'  +SUM(1,2)");
  assert.equal(safeSpreadsheetCell("Обычная запись"), "Обычная запись");
});

test("rejects unsafe imported identifiers and excessive records", () => {
  assert.equal(normalizeSnapshot({
    ...snapshot,
    accounts: [{
      id: "\"><img src=x onerror=alert(1)>",
      name: "X",
      type: "card",
      initialBalance: 0,
      currency: "KZT",
    }],
  }), null);

  assert.equal(normalizeSnapshot({
    ...snapshot,
    accounts: Array.from({ length: 101 }, (_, index) => ({
      id: `account_${index}`,
      name: "X",
      type: "card",
      initialBalance: 0,
      currency: "KZT",
    })),
  }), null);
});

test("clears local financial data when a different user signs in", () => {
  const values = new Map([
    ["fintrack_storage_owner", "user-one"],
    ["fintrack_transactions", JSON.stringify([{ id: "private" }])],
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };

  bindStorageToUser("user-two");
  assert.equal(values.has("fintrack_transactions"), false);
  assert.equal(values.get("fintrack_storage_owner"), "user-two");
});
