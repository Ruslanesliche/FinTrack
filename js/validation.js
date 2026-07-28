const MAX_NUMBER = 1_000_000_000_000_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u;
const SAFE_COLOR = /^#[0-9a-f]{6}$/iu;
const SAFE_ICON = /^[a-z0-9][a-z0-9-]{0,49}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_TIME = /^\d{2}:\d{2}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/u;

const STORE_LIMITS = {
  accounts: 100,
  transactions: 10_000,
  categories: 300,
  budgets: 1_000,
  goals: 1_000,
  debts: 1_000,
  recurring: 1_000,
};

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max, { optional = false } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== "string" || value.length > max) throw new TypeError("invalid_text");
  return value;
}

function id(value, { optional = false } = {}) {
  if ((value == null || value === "") && optional) return null;
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new TypeError("invalid_id");
  return value;
}

function number(value, { min = 0, max = MAX_NUMBER, optional = false } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError("invalid_number");
  }
  return value;
}

function integer(value, options = {}) {
  const result = number(value, options);
  if (!Number.isInteger(result)) throw new TypeError("invalid_integer");
  return result;
}

function boolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new TypeError("invalid_boolean");
  return value;
}

function oneOf(value, allowed, fallback) {
  if (value == null && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw new TypeError("invalid_enum");
  return value;
}

function date(value, { optional = false } = {}) {
  if ((value == null || value === "") && optional) return null;
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new TypeError("invalid_date");
  return value;
}

function time(value, { optional = false } = {}) {
  if ((value == null || value === "") && optional) return null;
  if (typeof value !== "string" || !ISO_TIME.test(value)) throw new TypeError("invalid_time");
  return value;
}

function timestamp(value, { optional = true } = {}) {
  if ((value == null || value === "") && optional) return null;
  if (typeof value !== "string" || value.length > 40 || !ISO_TIMESTAMP.test(value)) {
    throw new TypeError("invalid_timestamp");
  }
  return value;
}

function color(value, fallback = "#5f796b") {
  if (value == null) return fallback;
  if (typeof value !== "string" || !SAFE_COLOR.test(value)) throw new TypeError("invalid_color");
  return value.toLowerCase();
}

function icon(value, fallback = "circle-dot") {
  if (value == null) return fallback;
  if (typeof value !== "string" || !SAFE_ICON.test(value)) throw new TypeError("invalid_icon");
  return value;
}

function idArray(value, max = 300) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new TypeError("invalid_id_array");
  return value.map((entry) => id(entry));
}

function textArray(value, maxItems = 20, maxLength = 50) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new TypeError("invalid_text_array");
  return value.map((entry) => text(entry, maxLength));
}

function baseRecord(record) {
  if (!plainObject(record)) throw new TypeError("invalid_record");
  return {
    id: id(record.id),
    createdAt: timestamp(record.createdAt),
    updatedAt: timestamp(record.updatedAt),
  };
}

function cleanAccount(record) {
  return {
    ...baseRecord(record),
    name: text(record.name, 80),
    type: oneOf(record.type, ["cash", "card", "deposit", "wallet", "savings", "bank", "other"], "other"),
    initialBalance: number(record.initialBalance, { min: -MAX_NUMBER }),
    currency: text(record.currency, 8),
    color: color(record.color, "#365f51"),
    icon: icon(record.icon, "wallet-cards"),
    active: boolean(record.active, true),
    includeInTotal: boolean(record.includeInTotal, true),
  };
}

function cleanTransaction(record) {
  return {
    ...baseRecord(record),
    type: oneOf(record.type, ["income", "expense", "transfer"]),
    amount: number(record.amount),
    categoryId: id(record.categoryId, { optional: true }),
    accountId: id(record.accountId),
    toAccountId: id(record.toAccountId, { optional: true }),
    date: date(record.date),
    time: time(record.time, { optional: true }),
    description: text(record.description ?? "", 120),
    note: text(record.note ?? "", 1_000),
    tags: textArray(record.tags, 20, 50),
    paymentMethod: oneOf(record.paymentMethod, ["card", "cash", "transfer", "bank", "other"], "card"),
    status: oneOf(record.status, ["completed", "planned"], "completed"),
    recurring: boolean(record.recurring, false),
    recurringToken: text(record.recurringToken, 150, { optional: true }),
  };
}

function cleanCategory(record) {
  return {
    ...baseRecord(record),
    name: text(record.name, 80),
    type: oneOf(record.type, ["income", "expense"]),
    icon: icon(record.icon, "shapes"),
    color: color(record.color),
    active: boolean(record.active, true),
    system: boolean(record.system, false),
    limit: number(record.limit ?? 0),
  };
}

function cleanBudget(record) {
  return {
    ...baseRecord(record),
    name: text(record.name, 100),
    limit: number(record.limit),
    period: oneOf(record.period, ["month"], "month"),
    categoryIds: idArray(record.categoryIds),
    startDate: date(record.startDate),
    recurring: boolean(record.recurring, true),
  };
}

function cleanGoal(record) {
  return {
    ...baseRecord(record),
    name: text(record.name, 100),
    target: number(record.target),
    saved: number(record.saved),
    deadline: date(record.deadline),
    icon: icon(record.icon, "target"),
    color: color(record.color),
    note: text(record.note ?? "", 1_000),
  };
}

function cleanDebt(record) {
  if (!Array.isArray(record.payments) || record.payments.length > 2_000) {
    throw new TypeError("invalid_payments");
  }
  return {
    ...baseRecord(record),
    type: oneOf(record.type, ["owed_to_me", "i_owe"]),
    person: text(record.person, 120),
    amount: number(record.amount),
    currency: text(record.currency, 8),
    createdDate: date(record.createdDate),
    dueDate: date(record.dueDate),
    description: text(record.description ?? "", 1_000),
    status: oneOf(record.status, ["active", "paid"], "active"),
    repaid: number(record.repaid ?? 0),
    contact: text(record.contact ?? "", 200),
    payments: record.payments.map((payment) => {
      if (!plainObject(payment)) throw new TypeError("invalid_payment");
      return { amount: number(payment.amount), date: date(payment.date) };
    }),
  };
}

function cleanRecurring(record) {
  return {
    ...baseRecord(record),
    type: oneOf(record.type, ["income", "expense"]),
    amount: number(record.amount),
    categoryId: id(record.categoryId),
    accountId: id(record.accountId),
    description: text(record.description ?? "", 120),
    frequency: oneOf(record.frequency, ["daily", "weekly", "monthly", "yearly"]),
    interval: integer(record.interval ?? 1, { min: 1, max: 365 }),
    day: integer(record.day ?? 1, { min: 1, max: 31 }),
    lastCreated: date(record.lastCreated, { optional: true }),
    active: boolean(record.active, true),
  };
}

const CLEANERS = {
  accounts: cleanAccount,
  transactions: cleanTransaction,
  categories: cleanCategory,
  budgets: cleanBudget,
  goals: cleanGoal,
  debts: cleanDebt,
  recurring: cleanRecurring,
};

function cleanSettings(settings) {
  if (!plainObject(settings)) throw new TypeError("invalid_settings");
  return {
    userName: text(settings.userName ?? "", 80),
    currency: text(settings.currency ?? "KZT", 8),
    dateFormat: oneOf(settings.dateFormat, ["DD.MM.YYYY", "YYYY-MM-DD"], "DD.MM.YYYY"),
    firstDay: oneOf(settings.firstDay, ["monday", "sunday"], "monday"),
    theme: oneOf(settings.theme, ["system", "light", "dark"], "system"),
    accent: oneOf(settings.accent, ["green", "blue", "plum"], "green"),
    hideBalance: boolean(settings.hideBalance, false),
    animations: boolean(settings.animations, true),
    confirmDelete: boolean(settings.confirmDelete, true),
    numberFormat: oneOf(settings.numberFormat, ["spaces", "comma"], "spaces"),
    onboardingCompleted: boolean(settings.onboardingCompleted, false),
  };
}

function cleanAppState(appState) {
  if (appState == null) return {};
  if (!plainObject(appState)) throw new TypeError("invalid_app_state");
  return {
    selectedPeriod: oneOf(appState.selectedPeriod, ["today", "week", "month", "year", "all"], "month"),
    analyticsPeriod: oneOf(appState.analyticsPeriod, ["month", "year", "all"], "year"),
    debtFilter: oneOf(appState.debtFilter, ["active", "paid", "all"], "active"),
    structureTab: oneOf(appState.structureTab, ["categories", "accounts"], "categories"),
    searchHistory: textArray(appState.searchHistory, 10, 120),
    favoriteCategories: textArray(appState.favoriteCategories, 30, 80),
    lastRecurringCheck: date(appState.lastRecurringCheck, { optional: true }),
    dataVersion: integer(appState.dataVersion ?? 1, { min: 1, max: 100 }),
  };
}

export function normalizeSnapshot(data) {
  try {
    if (!plainObject(data)) return null;
    const result = {
      app: "FinTrack",
      version: integer(data.version ?? 1, { min: 1, max: 100 }),
      exportedAt: timestamp(data.exportedAt),
      settings: cleanSettings(data.settings),
      appState: cleanAppState(data.appState),
    };
    for (const [store, cleaner] of Object.entries(CLEANERS)) {
      const records = data[store];
      if (!Array.isArray(records) || records.length > STORE_LIMITS[store]) return null;
      result[store] = records.map(cleaner);
    }
    return result;
  } catch {
    return null;
  }
}

export function validateSnapshotData(data) {
  return normalizeSnapshot(data) !== null;
}
