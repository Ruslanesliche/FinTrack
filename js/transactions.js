import { create, getAll, getById, remove, update } from "./storage.js";
import { inPeriod, parseAmount, todayISO } from "./utils.js";

export function normalizeTransaction(data) {
  const amount = parseAmount(data.amount);
  if (amount <= 0) throw new Error("Укажите сумму больше нуля.");
  if (!["income", "expense", "transfer"].includes(data.type)) throw new Error("Выберите тип операции.");
  if (!data.accountId) throw new Error("Выберите счёт.");
  if (data.type !== "transfer" && !data.categoryId) throw new Error("Выберите категорию.");
  if (data.type === "transfer" && (!data.toAccountId || data.toAccountId === data.accountId)) {
    throw new Error("Для перевода выберите другой счёт.");
  }
  return {
    type: data.type,
    amount,
    categoryId: data.categoryId || null,
    accountId: data.accountId,
    toAccountId: data.type === "transfer" ? data.toAccountId : null,
    date: data.date || todayISO(),
    time: data.time || new Date().toTimeString().slice(0, 5),
    description: String(data.description || "").trim(),
    note: String(data.note || "").trim(),
    tags: Array.isArray(data.tags) ? data.tags : String(data.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    paymentMethod: data.paymentMethod || "card",
    status: data.status || "completed",
    recurring: Boolean(data.recurring),
  };
}

export function createTransaction(data) {
  return create("transactions", normalizeTransaction(data));
}

export function updateTransaction(id, data) {
  return update("transactions", id, normalizeTransaction(data));
}

export function duplicateTransaction(id) {
  const source = getById("transactions", id);
  if (!source) return null;
  const { id: ignored, createdAt: ignoredCreated, updatedAt: ignoredUpdated, ...copy } = source;
  return create("transactions", { ...copy, date: todayISO(), description: copy.description ? `${copy.description} — копия` : "Копия операции" });
}

export function deleteTransaction(id) {
  return remove("transactions", id);
}

export function restoreTransaction(transaction) {
  return create("transactions", transaction);
}

export function getAccountBalance(accountId) {
  const account = getById("accounts", accountId);
  if (!account) return 0;
  return getAll("transactions").reduce((balance, item) => {
    if (item.status !== "completed") return balance;
    if (item.type === "income" && item.accountId === accountId) return balance + item.amount;
    if (item.type === "expense" && item.accountId === accountId) return balance - item.amount;
    if (item.type === "transfer" && item.accountId === accountId) return balance - item.amount;
    if (item.type === "transfer" && item.toAccountId === accountId) return balance + item.amount;
    return balance;
  }, Number(account.initialBalance) || 0);
}

export function getTotalBalance() {
  return getAll("accounts")
    .filter((account) => account.active !== false && account.includeInTotal !== false)
    .reduce((sum, account) => sum + getAccountBalance(account.id), 0);
}

export function periodSummary(period = "month") {
  const transactions = getAll("transactions").filter((item) => item.status === "completed" && inPeriod(item.date, period));
  const income = transactions.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  return { income, expense, net: income - expense, count: transactions.length };
}

export function filterTransactions(filters = {}) {
  const query = String(filters.query || "").trim().toLocaleLowerCase("ru");
  const min = parseAmount(filters.min);
  const max = parseAmount(filters.max);
  const result = getAll("transactions").filter((item) => {
    if (filters.type && filters.type !== "all" && item.type !== filters.type) return false;
    if (filters.categoryId && filters.categoryId !== "all" && item.categoryId !== filters.categoryId) return false;
    if (filters.accountId && filters.accountId !== "all" && item.accountId !== filters.accountId) return false;
    if (filters.period && filters.period !== "all" && !inPeriod(item.date, filters.period)) return false;
    if (min && item.amount < min) return false;
    if (max && item.amount > max) return false;
    if (query) {
      const haystack = [item.description, item.note, ...(item.tags || [])].join(" ").toLocaleLowerCase("ru");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  const direction = filters.sort === "oldest" ? 1 : -1;
  return result.sort((a, b) => direction * `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

export function processRecurringOperations() {
  const today = new Date();
  const recurring = getAll("recurring");
  const existing = getAll("transactions");
  const created = [];
  recurring.forEach((item) => {
    if (!item.active) return;
    const last = new Date(`${item.lastCreated || "2000-01-01"}T12:00:00`);
    let due = false;
    if (item.frequency === "daily") due = today - last >= (item.interval || 1) * 86_400_000;
    if (item.frequency === "weekly") due = today - last >= (item.interval || 1) * 7 * 86_400_000;
    if (item.frequency === "yearly") due = today.getFullYear() > last.getFullYear();
    if (item.frequency === "monthly") {
      due = today.getMonth() !== last.getMonth() || today.getFullYear() !== last.getFullYear();
      due = due && today.getDate() >= Math.min(item.day || 1, 28);
    }
    const token = `${item.id}:${todayISO()}`;
    if (due && !existing.some((transaction) => transaction.recurringToken === token)) {
      const transaction = create("transactions", {
        type: item.type,
        amount: item.amount,
        categoryId: item.categoryId,
        accountId: item.accountId,
        date: todayISO(),
        time: "09:00",
        description: item.description,
        note: "Создано автоматически",
        tags: ["регулярная"],
        paymentMethod: "card",
        status: "completed",
        recurring: true,
        recurringToken: token,
      });
      update("recurring", item.id, { lastCreated: todayISO() });
      created.push(transaction);
    }
  });
  return created;
}
