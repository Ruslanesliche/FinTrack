import { create, getAll, update } from "./storage.js";
import { clamp, daysUntil, generateId, startOfPeriod } from "./utils.js";

export function budgetProgress(budget) {
  const start = startOfPeriod("month");
  const expenses = getAll("transactions").filter((item) => {
    const date = new Date(`${item.date}T12:00:00`);
    return item.type === "expense"
      && item.status === "completed"
      && date >= start
      && (!budget.categoryIds?.length || budget.categoryIds.includes(item.categoryId));
  });
  const spent = expenses.reduce((sum, item) => sum + item.amount, 0);
  const limit = Number(budget.limit) || 0;
  const percent = limit ? (spent / limit) * 100 : 0;
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysLeft = Math.max(0, daysUntil(end.toISOString().slice(0, 10)));
  const elapsedDays = Math.max(1, now.getDate());
  const forecast = spent / elapsedDays * end.getDate();
  return {
    spent,
    remaining: limit - spent,
    percent,
    displayPercent: clamp(percent, 0, 100),
    daysLeft,
    forecast,
    state: percent >= 100 ? "exceeded" : percent >= 80 ? "warning" : "normal",
  };
}

export function createBudget(data) {
  return create("budgets", {
    id: generateId("budget"),
    name: String(data.name || "Новый бюджет").trim(),
    limit: Math.max(0, Number(data.limit) || 0),
    period: "month",
    categoryIds: Array.isArray(data.categoryIds) ? data.categoryIds : [],
    startDate: data.startDate,
    recurring: data.recurring !== false,
  });
}

export function updateBudget(id, data) {
  return update("budgets", id, data);
}

export function activeBudgetAlerts() {
  return getAll("budgets").map((budget) => ({ budget, progress: budgetProgress(budget) })).filter(({ progress }) => progress.percent >= 50);
}
