import { getAll } from "./storage.js";
import { inPeriod, monthKey } from "./utils.js";
import { getTotalBalance } from "./transactions.js";

export function analyticsSummary(period = "year") {
  const transactions = getAll("transactions").filter((item) => item.status === "completed" && (period === "all" || inPeriod(item.date, period)));
  const incomeItems = transactions.filter((item) => item.type === "income");
  const expenseItems = transactions.filter((item) => item.type === "expense");
  const income = incomeItems.reduce((sum, item) => sum + item.amount, 0);
  const expense = expenseItems.reduce((sum, item) => sum + item.amount, 0);
  const uniqueDays = new Set(expenseItems.map((item) => item.date)).size || 1;
  const largestExpense = expenseItems.reduce((largest, item) => item.amount > (largest?.amount || 0) ? item : largest, null);
  const byCategory = Object.entries(expenseItems.reduce((map, item) => {
    map[item.categoryId] = (map[item.categoryId] || 0) + item.amount;
    return map;
  }, {})).sort((a, b) => b[1] - a[1]);
  return {
    income,
    expense,
    net: income - expense,
    averageDaily: expense / uniqueDays,
    largestExpense,
    topCategoryId: byCategory[0]?.[0] || null,
    count: transactions.length,
    savingsRate: income ? ((income - expense) / income) * 100 : 0,
    balance: getTotalBalance(),
    byCategory,
  };
}

export function monthlySeries(months = 6) {
  const now = new Date();
  const keys = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  const labels = keys.map((key) => new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(new Date(`${key}-01T12:00:00`)));
  const transactions = getAll("transactions");
  return {
    labels,
    income: keys.map((key) => transactions.filter((item) => item.type === "income" && monthKey(item.date) === key).reduce((sum, item) => sum + item.amount, 0)),
    expense: keys.map((key) => transactions.filter((item) => item.type === "expense" && monthKey(item.date) === key).reduce((sum, item) => sum + item.amount, 0)),
  };
}

export function weekdaySeries() {
  const labels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const values = new Array(7).fill(0);
  getAll("transactions").filter((item) => item.type === "expense").forEach((item) => {
    const day = new Date(`${item.date}T12:00:00`).getDay() || 7;
    values[day - 1] += item.amount;
  });
  return { labels, values };
}

export function accountExpenseSeries() {
  const accounts = getAll("accounts");
  const transactions = getAll("transactions").filter((item) => item.type === "expense");
  return {
    labels: accounts.map((account) => account.name),
    values: accounts.map((account) => transactions.filter((item) => item.accountId === account.id).reduce((sum, item) => sum + item.amount, 0)),
  };
}
