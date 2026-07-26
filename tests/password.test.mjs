import test from "node:test";
import assert from "node:assert/strict";

import {
  isStrongPassword,
  passwordChecks,
  passwordStrength,
} from "../js/password.js";

test("rejects short passwords and personal information", () => {
  const checks = passwordChecks("ruslan2004", {
    name: "Ruslan",
    email: "ruslan@example.com",
  });
  assert.equal(checks.find((check) => check.id === "length").passed, false);
  assert.equal(checks.find((check) => check.id === "personal").passed, false);
  assert.equal(isStrongPassword("ruslan2004", { name: "Ruslan" }), false);
});

test("rejects common passwords and simple sequences", () => {
  assert.equal(isStrongPassword("Qwerty123456!"), false);
  assert.equal(isStrongPassword("SafeSequence1234!"), false);
});

test("accepts long unique passwords and passphrases", () => {
  assert.equal(isStrongPassword("Maple!Orbit7-Copper"), true);
  assert.equal(isStrongPassword("тихий маяк зелёный горизонт"), true);
  assert.equal(passwordStrength("Maple!Orbit7-Copper").score >= 3, true);
});
