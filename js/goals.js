import { create, getById, update } from "./storage.js";
import { clamp, daysUntil, generateId } from "./utils.js";
import { getAccountBalance } from "./transactions.js";

export function goalProgress(goal) {
  const target = Number(goal.target) || 0;
  const saved = Number(goal.saved) || 0;
  const days = Math.max(0, daysUntil(goal.deadline));
  const months = Math.max(1, Math.ceil(days / 30.4));
  return {
    percent: target ? (saved / target) * 100 : 0,
    displayPercent: clamp(target ? (saved / target) * 100 : 0, 0, 100),
    remaining: Math.max(0, target - saved),
    recommendedMonthly: Math.max(0, target - saved) / months,
    complete: target > 0 && saved >= target,
  };
}

export function createGoal(data) {
  return create("goals", {
    id: generateId("goal"),
    name: String(data.name || "Новая цель").trim(),
    target: Math.max(0, Number(data.target) || 0),
    saved: Math.max(0, Number(data.saved) || 0),
    deadline: data.deadline,
    icon: data.icon || "target",
    color: data.color || "#4f7d61",
    note: String(data.note || "").trim(),
  });
}

export function changeGoalSavings(id, amount, operation = "add", accountId = null) {
  const goal = getById("goals", id);
  if (!goal) throw new Error("Цель не найдена.");
  const value = Math.max(0, Number(amount) || 0);
  if (!value) throw new Error("Укажите сумму.");
  if (accountId && operation === "add" && getAccountBalance(accountId) < value) throw new Error("На выбранном счёте недостаточно средств.");
  const saved = operation === "subtract" ? Math.max(0, goal.saved - value) : goal.saved + value;
  return update("goals", id, { saved });
}
