import { DEFAULT_CATEGORIES } from "./categories.js";
import { generateId, todayISO } from "./utils.js";

export const STORAGE_KEYS = {
  settings: "fintrack_settings",
  accounts: "fintrack_accounts",
  transactions: "fintrack_transactions",
  categories: "fintrack_categories",
  budgets: "fintrack_budgets",
  goals: "fintrack_goals",
  debts: "fintrack_debts",
  recurring: "fintrack_recurring",
  backups: "fintrack_backups",
  appState: "fintrack_app_state",
};

const ARRAY_STORES = ["accounts", "transactions", "categories", "budgets", "goals", "debts", "recurring", "backups"];

const defaults = {
  settings: {
    userName: "Руслан",
    currency: "KZT",
    dateFormat: "DD.MM.YYYY",
    firstDay: "monday",
    theme: "system",
    accent: "green",
    hideBalance: false,
    animations: true,
    confirmDelete: true,
    numberFormat: "spaces",
    onboardingCompleted: false,
  },
  appState: {
    selectedPeriod: "month",
    searchHistory: [],
    lastRecurringCheck: null,
    dataVersion: 1,
  },
  accounts: [],
  transactions: [],
  categories: [],
  budgets: [],
  goals: [],
  debts: [],
  recurring: [],
  backups: [],
};

function read(store) {
  const key = STORAGE_KEYS[store];
  if (!key) throw new Error(`Неизвестное хранилище: ${store}`);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(defaults[store]);
    const value = JSON.parse(raw);
    return value ?? structuredClone(defaults[store]);
  } catch {
    return structuredClone(defaults[store]);
  }
}

function write(store, value) {
  localStorage.setItem(STORAGE_KEYS[store], JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("fintrack:datachange", { detail: { store } }));
  return value;
}

export function getAll(store) {
  const value = read(store);
  return Array.isArray(value) ? value : [];
}

export function getById(store, id) {
  return getAll(store).find((item) => item.id === id) || null;
}

export function create(store, record) {
  const items = getAll(store);
  const next = { ...record, id: record.id || generateId(store.slice(0, 3)), createdAt: record.createdAt || new Date().toISOString() };
  items.unshift(next);
  write(store, items);
  return next;
}

export function update(store, id, patch) {
  const items = getAll(store);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], ...patch, id, updatedAt: new Date().toISOString() };
  write(store, items);
  return items[index];
}

export function remove(store, id) {
  const items = getAll(store);
  const record = items.find((item) => item.id === id);
  write(store, items.filter((item) => item.id !== id));
  return record || null;
}

export function clear(store) {
  write(store, structuredClone(defaults[store]));
}

export function getSettings() {
  return { ...defaults.settings, ...read("settings") };
}

export function saveSettings(patch) {
  return write("settings", { ...getSettings(), ...patch });
}

export function getAppState() {
  return { ...defaults.appState, ...read("appState") };
}

export function saveAppState(patch) {
  return write("appState", { ...getAppState(), ...patch });
}

export function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const required = ["settings", "accounts", "transactions", "categories", "budgets", "goals", "debts", "recurring"];
  return required.every((key) => key === "settings"
    ? data[key] && typeof data[key] === "object" && !Array.isArray(data[key])
    : Array.isArray(data[key]));
}

export function exportAll() {
  return {
    app: "FinTrack",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    appState: getAppState(),
    ...Object.fromEntries(ARRAY_STORES.filter((store) => store !== "backups").map((store) => [store, getAll(store)])),
  };
}

export function importAll(data) {
  if (!validateData(data)) throw new Error("Файл не похож на резервную копию FinTrack.");
  write("backups", [{ id: generateId("backup"), createdAt: new Date().toISOString(), data: exportAll() }, ...getAll("backups")].slice(0, 5));
  write("settings", { ...defaults.settings, ...data.settings });
  write("appState", { ...defaults.appState, ...(data.appState || {}) });
  for (const store of ARRAY_STORES.filter((name) => name !== "backups")) write(store, structuredClone(data[store] || []));
  return true;
}

export function restoreLatestBackup() {
  const backup = getAll("backups")[0];
  if (!backup?.data) throw new Error("Локальная резервная копия не найдена.");
  return importAll(backup.data);
}

function monthDate(monthOffset, day) {
  const date = new Date();
  date.setMonth(date.getMonth() + monthOffset, day);
  return date.toISOString().slice(0, 10);
}

function demoTransactions(accounts, categories) {
  const expenseNames = ["Продукты", "Транспорт", "Жильё", "Коммунальные услуги", "Кафе и рестораны", "Здоровье", "Одежда", "Развлечения", "Обучение", "Подписки", "Автомобиль", "Путешествия"];
  const templates = [
    ["expense", "Продукты", 18450, "Magnum — продукты", -2, 23],
    ["expense", "Транспорт", 3200, "Такси", -1, 19],
    ["expense", "Кафе и рестораны", 6800, "Обед с друзьями", 0, 16],
    ["expense", "Коммунальные услуги", 26700, "Коммунальные услуги", 0, 9],
    ["expense", "Подписки", 4990, "Музыка и облако", 0, 4],
    ["income", "Зарплата", 520000, "Зарплата", 0, 2],
    ["income", "Фриланс", 95000, "Дизайн лендинга", -1, 26],
    ["expense", "Автомобиль", 22000, "Бензин", -1, 22],
    ["expense", "Одежда", 34900, "Куртка", -1, 15],
    ["expense", "Здоровье", 12800, "Аптека", -1, 10],
    ["expense", "Обучение", 44000, "Онлайн-курс", -2, 18],
    ["income", "Возврат долга", 30000, "Возврат от Айбека", -2, 8],
  ];
  const list = [];
  for (let offset = 0; offset > -4; offset -= 1) {
    templates.forEach((item, index) => {
      if ((index + Math.abs(offset)) % 3 !== 1 || offset === 0) {
        const [type, name, amount, description, templateOffset, day] = item;
        const category = categories.find((categoryItem) => categoryItem.name === name && categoryItem.type === type)
          || categories.find((categoryItem) => categoryItem.name === (type === "income" ? "Другое" : expenseNames[index % expenseNames.length]) && categoryItem.type === type);
        list.push({
          id: generateId("txn"),
          type,
          amount,
          categoryId: category?.id,
          accountId: accounts[(index + Math.abs(offset)) % accounts.length].id,
          date: monthDate(offset + templateOffset, Math.min(day, 27)),
          time: `${String(9 + (index % 9)).padStart(2, "0")}:15`,
          description,
          note: index % 4 === 0 ? "Демонстрационная операция" : "",
          tags: index % 3 === 0 ? ["ежедневное"] : [],
          paymentMethod: index % 2 ? "card" : "cash",
          status: "completed",
          recurring: false,
          createdAt: new Date().toISOString(),
        });
      }
    });
  }
  return list.slice(0, 42);
}

export function initializeDemoData({ initialBalance = 350000, currency = "KZT", force = false } = {}) {
  if (!force && getAll("accounts").length) return false;
  const categories = structuredClone(DEFAULT_CATEGORIES);
  const accounts = [
    { id: "acc_cash", name: "Наличные", type: "cash", initialBalance: initialBalance * 0.14, currency, color: "#6d7d6c", icon: "wallet-cards", active: true, includeInTotal: true },
    { id: "acc_card", name: "Основная карта", type: "card", initialBalance: initialBalance * 0.61, currency, color: "#365f51", icon: "credit-card", active: true, includeInTotal: true },
    { id: "acc_savings", name: "Накопления", type: "savings", initialBalance: initialBalance * 0.25, currency, color: "#6d6280", icon: "landmark", active: true, includeInTotal: true },
  ];
  write("categories", categories);
  write("accounts", accounts);
  write("transactions", demoTransactions(accounts, categories));
  write("budgets", [
    { id: "budget_total", name: "Основной бюджет", limit: 300000, period: "month", categoryIds: [], startDate: monthDate(0, 1), recurring: true },
    { id: "budget_food", name: "Еда вне дома", limit: 45000, period: "month", categoryIds: [categories.find((item) => item.name === "Кафе и рестораны").id], startDate: monthDate(0, 1), recurring: true },
    { id: "budget_auto", name: "Автомобиль", limit: 60000, period: "month", categoryIds: [categories.find((item) => item.name === "Автомобиль").id], startDate: monthDate(0, 1), recurring: true },
  ]);
  write("goals", [
    { id: "goal_trip", name: "Путешествие в Японию", target: 1500000, saved: 620000, deadline: monthDate(8, 15), icon: "plane", color: "#4e7d82", note: "Весеннее путешествие" },
    { id: "goal_buffer", name: "Финансовая подушка", target: 2400000, saved: 980000, deadline: monthDate(14, 1), icon: "shield-check", color: "#4f7d61", note: "Запас на 6 месяцев" },
    { id: "goal_phone", name: "Новый телефон", target: 650000, saved: 510000, deadline: monthDate(3, 20), icon: "smartphone", color: "#736780", note: "" },
  ]);
  write("debts", [
    { id: "debt_1", type: "owed_to_me", person: "Айбек", amount: 120000, currency, createdDate: monthDate(-1, 4), dueDate: monthDate(0, 28), description: "Совместная поездка", status: "active", repaid: 30000, contact: "", payments: [{ amount: 30000, date: monthDate(0, 5) }] },
    { id: "debt_2", type: "i_owe", person: "Данияр", amount: 80000, currency, createdDate: monthDate(-2, 17), dueDate: monthDate(1, 10), description: "Ремонт ноутбука", status: "active", repaid: 20000, contact: "", payments: [{ amount: 20000, date: monthDate(-1, 23) }] },
    { id: "debt_3", type: "owed_to_me", person: "Алина", amount: 45000, currency, createdDate: monthDate(-3, 8), dueDate: monthDate(-1, 20), description: "Билеты", status: "active", repaid: 0, contact: "", payments: [] },
    { id: "debt_4", type: "i_owe", person: "Марат", amount: 55000, currency, createdDate: monthDate(-4, 9), dueDate: monthDate(-2, 14), description: "Подарок", status: "paid", repaid: 55000, contact: "", payments: [{ amount: 55000, date: monthDate(-2, 13) }] },
  ]);
  write("recurring", [
    { id: "rec_salary", type: "income", amount: 520000, categoryId: categories.find((item) => item.name === "Зарплата").id, accountId: "acc_card", description: "Зарплата", frequency: "monthly", interval: 1, day: 2, lastCreated: monthDate(0, 2), active: true },
    { id: "rec_rent", type: "expense", amount: 120000, categoryId: categories.find((item) => item.name === "Жильё").id, accountId: "acc_card", description: "Аренда", frequency: "monthly", interval: 1, day: 5, lastCreated: monthDate(0, 5), active: true },
    { id: "rec_internet", type: "expense", amount: 7990, categoryId: categories.find((item) => item.name === "Коммунальные услуги").id, accountId: "acc_card", description: "Интернет", frequency: "monthly", interval: 1, day: 12, lastCreated: monthDate(-1, 12), active: true },
    { id: "rec_subscription", type: "expense", amount: 4990, categoryId: categories.find((item) => item.name === "Подписки").id, accountId: "acc_card", description: "Подписка", frequency: "monthly", interval: 1, day: 18, lastCreated: monthDate(-1, 18), active: true },
  ]);
  saveSettings({ currency });
  return true;
}

export function initializeEmptyData({ initialBalance = 0, currency = "KZT" } = {}) {
  write("categories", structuredClone(DEFAULT_CATEGORIES));
  write("accounts", [{
    id: "acc_main",
    name: "Основной счёт",
    type: "card",
    initialBalance,
    currency,
    color: "#365f51",
    icon: "credit-card",
    active: true,
    includeInTotal: true,
  }]);
  for (const store of ["transactions", "budgets", "goals", "debts", "recurring"]) write(store, []);
  saveSettings({ currency });
}

export function resetApplication() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
}

export { read, write };
