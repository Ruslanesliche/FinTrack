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
  assert.match(
    friendlyAuthError({ code: "anonymous_provider_disabled" }, "fallback"),
    /не передала email/,
  );
});

test("does not expose provider diagnostics for unknown errors", () => {
  assert.equal(
    friendlyAuthError(
      { code: "unknown", status: 422, message: "Unknown signup problem" },
      "fallback",
    ),
    "fallback",
  );
});

test("does not reveal whether an account exists", () => {
  const message = friendlyAuthError(
    { code: "user_already_exists", message: "already registered" },
    "fallback",
  );
  assert.doesNotMatch(message, /существует|зарегистрирован/iu);
});

test("keeps the provided fallback when the error has no diagnostics", () => {
  assert.equal(friendlyAuthError({}, "fallback"), "fallback");
});
