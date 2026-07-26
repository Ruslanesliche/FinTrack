import { create, getById, update } from "./storage.js";
import { generateId, todayISO } from "./utils.js";

export function debtStatus(debt) {
  const remaining = Math.max(0, Number(debt.amount) - Number(debt.repaid || 0));
  const overdue = debt.status !== "paid" && debt.dueDate && new Date(`${debt.dueDate}T23:59:59`) < new Date();
  return { remaining, overdue, paid: remaining <= 0 || debt.status === "paid" };
}

export function createDebt(data) {
  return create("debts", {
    id: generateId("debt"),
    type: data.type === "i_owe" ? "i_owe" : "owed_to_me",
    person: String(data.person || "").trim(),
    amount: Math.max(0, Number(data.amount) || 0),
    currency: data.currency || "KZT",
    createdDate: data.createdDate || todayISO(),
    dueDate: data.dueDate || todayISO(),
    description: String(data.description || "").trim(),
    status: "active",
    repaid: 0,
    contact: String(data.contact || "").trim(),
    payments: [],
  });
}

export function repayDebt(id, amount) {
  const debt = getById("debts", id);
  if (!debt) throw new Error("Долг не найден.");
  const value = Math.max(0, Number(amount) || 0);
  const repaid = Math.min(debt.amount, Number(debt.repaid || 0) + value);
  return update("debts", id, {
    repaid,
    status: repaid >= debt.amount ? "paid" : "active",
    payments: [...(debt.payments || []), { amount: value, date: todayISO() }],
  });
}
