export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 72;

const COMMON_PARTS = [
  "password",
  "passw0rd",
  "qwerty",
  "123456",
  "123456789",
  "admin",
  "letmein",
  "welcome",
  "fintrack",
  "пароль",
  "йцукен",
];

const SIMPLE_SEQUENCES = [
  "0123",
  "1234",
  "2345",
  "3456",
  "4567",
  "5678",
  "6789",
  "9876",
  "abcd",
  "qwer",
  "asdf",
];

function normalize(value) {
  return String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function personalTokens({ name = "", email = "" } = {}) {
  const localEmail = String(email).split("@")[0];
  return [...String(name).split(/\s+/), ...localEmail.split(/[._-]+/)]
    .map(normalize)
    .filter((token) => token.length >= 3);
}

function containsPersonalInfo(password, identity) {
  const normalized = normalize(password);
  return personalTokens(identity).some((token) => normalized.includes(token));
}

function containsCommonPattern(password) {
  const normalized = normalize(password);
  return COMMON_PARTS.some((part) => normalized.includes(part))
    || SIMPLE_SEQUENCES.some((part) => normalized.includes(part))
    || /(.)\1{3,}/u.test(String(password));
}

export function passwordStrength(password) {
  const value = String(password || "");
  if (!value) return { score: 0, label: "Введите пароль" };

  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 16) score += 1;

  const groups = [
    /\p{Ll}/u.test(value),
    /\p{Lu}/u.test(value),
    /\p{N}/u.test(value),
    /[^\p{L}\p{N}]/u.test(value),
  ].filter(Boolean).length;
  if (groups >= 2) score += 1;
  if (groups >= 3) score += 1;
  if (value.trim().split(/\s+/).length >= 3) score += 1;
  score = Math.min(4, score);

  return {
    score,
    label: ["Очень слабая", "Слабая", "Допустимая", "Хорошая", "Отличная"][score],
  };
}

export function passwordChecks(password, identity = {}) {
  const value = String(password || "");
  const strength = passwordStrength(value);
  return [
    {
      id: "length",
      passed: value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH,
    },
    {
      id: "personal",
      passed: Boolean(value) && !containsPersonalInfo(value, identity),
    },
    {
      id: "common",
      passed: Boolean(value) && !containsCommonPattern(value),
    },
    {
      id: "strength",
      passed: strength.score >= 3,
    },
  ];
}

export function isStrongPassword(password, identity = {}) {
  return passwordChecks(password, identity).every((check) => check.passed);
}
