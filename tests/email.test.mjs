import test from "node:test";
import assert from "node:assert/strict";

import { friendlyAuthError, normalizeEmail } from "../js/email.js";

test("normalizes casing, full-width characters and invisible characters in email", () => {
  assert.equal(
    normalizeEmail("  Rus.Tokseitov\u200B＠GMAIL。COM  "),
    "rus.tokseitov@gmail.com",
  );
});

test("explains Supabase SMTP and email errors precisely", () => {
  assert.match(
    friendlyAuthError({ code: "email_address_not_authorized" }, "fallback"),
    /Custom SMTP/,
  );
  assert.match(
    friendlyAuthError({ code: "email_address_invalid" }, "fallback"),
    /email_address_invalid/,
  );
  assert.match(
    friendlyAuthError({ status: 500 }, "fallback"),
    /SMTP/,
  );
});

test("keeps the provided fallback for unknown errors", () => {
  assert.equal(friendlyAuthError({ code: "unknown" }, "fallback"), "fallback");
});
