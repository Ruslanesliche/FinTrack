import { accountExpenseSeries, analyticsSummary, monthlySeries, weekdaySeries } from "./analytics.js";
import { exportCSV, exportJSON, importBackup, readBackupFile, restoreBackup } from "./backup.js";
import { activeBudgetAlerts, budgetProgress, createBudget } from "./budgets.js";
import { categoryById, createCategory } from "./categories.js";
import { createDebt, debtStatus, repayDebt } from "./debts.js";
import { changeGoalSavings, createGoal, goalProgress } from "./goals.js";
import { closeModal, confirmDialog, initializeModal, refreshIcons, showModal, showToast } from "./notifications.js";
import { startRouter } from "./router.js";
import { applySettings, bindSystemTheme, updateSettings } from "./settings.js";
import {
  create,
  exportAll,
  getAll,
  getAppState,
  getById,
  getSettings,
  initializeDemoData,
  initializeEmptyData,
  remove,
  resetApplication,
  saveAppState,
  saveSettings,
  update,
  validateData,
} from "./storage.js";
import {
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  filterTransactions,
  getAccountBalance,
  getTotalBalance,
  periodSummary,
  processRecurringOperations,
  restoreTransaction,
  updateTransaction,
} from "./transactions.js";
import {
  CURRENCIES,
  clamp,
  debounce,
  escapeHTML,
  formatDate,
  formatMoney,
  formatNumber,
  formatShortDate,
  generateId,
  monthKey,
  parseAmount,
  renderIcon,
  todayISO,
} from "./utils.js";

const view = document.getElementById("app-view");
const title = document.getElementById("page-title");
const eyebrow = document.getElementById("page-eyebrow");
let currentRoute = { name: "dashboard", params: [] };
let chartInstances = [];
let transactionLimit = 18;
let deferredInstallPrompt = null;

const NAV_ITEMS = [
  ["dashboard", "Главная", "house", "#/dashboard"],
  ["transactions", "Операции", "list-filter", "#/transactions"],
  ["analytics", "Аналитика", "chart-no-axes-combined", "#/analytics"],
  ["budgets", "Бюджеты", "wallet-minimal", "#/budgets"],
  ["goals", "Цели", "target", "#/goals"],
  ["debts", "Долги", "hand-coins", "#/debts"],
  ["categories", "Категории и счета", "shapes", "#/categories"],
  ["settings", "Настройки", "settings-2", "#/settings"],
];

const ROUTE_META = {
  dashboard: ["Главная", "Обзор финансов"],
  transactions: ["Операции", "История и управление"],
  transaction: ["Новая операция", "Быстрый и полный ввод"],
  analytics: ["Аналитика", "Картина ваших финансов"],
  budgets: ["Бюджеты", "Контроль лимитов"],
  goals: ["Финансовые цели", "Накопления и прогресс"],
  debts: ["Долги", "Мне должны и я должен"],
  categories: ["Категории и счета", "Структура финансов"],
  settings: ["Настройки", "Персонализация FinTrack"],
  backup: ["Резервная копия", "Экспорт и восстановление"],
  about: ["О приложении", "FinTrack Personal Finance Manager"],
  more: ["Еще", "Все возможности"],
  notFound: ["Страница не найдена", "Ошибка 404"],
};

function settings() {
  return getSettings();
}

function symbol() {
  return CURRENCIES[settings().currency]?.symbol || "₸";
}

function money(value, hidden = false) {
  return formatMoney(value, settings().currency, hidden);
}

function safeMoney(value, hidden = false) {
  return escapeHTML(money(value, hidden));
}

function accountName(id) {
  return getById("accounts", id)?.name || "Неизвестный счёт";
}

function category(id) {
  return categoryById(getAll("categories"), id);
}

function refreshUIIcons() {
  refreshIcons(document);
}

function clearCharts() {
  chartInstances.forEach((chart) => chart.destroy?.());
  chartInstances = [];
}

function setPageMeta(route) {
  const [pageTitle, pageEyebrow] = ROUTE_META[route.name] || ROUTE_META.notFound;
  title.textContent = pageTitle;
  eyebrow.textContent = pageEyebrow;
  document.title = `${pageTitle} — FinTrack`;
}

function renderNavigation() {
  document.getElementById("desktop-nav").innerHTML = NAV_ITEMS.map(([name, label, icon, href]) => `
    <a href="${href}" data-route="${name}">
      ${renderIcon(icon)}<span>${label}</span>
    </a>`).join("");
  updateActiveNavigation();
}

function updateActiveNavigation() {
  document.querySelectorAll("[data-route]").forEach((link) => {
    const route = link.dataset.route;
    const active = route === currentRoute.name
      || (currentRoute.name === "transaction" && route === "transactions")
      || (["budgets", "goals", "debts", "categories", "settings", "backup", "about"].includes(currentRoute.name) && route === "more");
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function page(html) {
  clearCharts();
  view.onclick = null;
  view.innerHTML = `<div class="section-stack">${html}</div>`;
  updateActiveNavigation();
  refreshUIIcons();
  view.focus({ preventScroll: true });
}

function renderEmpty(icon, heading, copy, action = "") {
  return `<div class="empty-state">
    <div class="empty-icon">${renderIcon(icon)}</div>
    <h3>${escapeHTML(heading)}</h3>
    <p>${escapeHTML(copy)}</p>
    ${action}
  </div>`;
}

function renderPeriodTabs(active, id = "period-tabs") {
  return `<div class="period-tabs" id="${id}" aria-label="Выберите период">
    ${[
      ["today", "Сегодня"],
      ["week", "Неделя"],
      ["month", "Месяц"],
      ["year", "Год"],
    ].map(([value, label]) => `<button type="button" data-period="${value}" class="${active === value ? "active" : ""}">${label}</button>`).join("")}
  </div>`;
}

function renderTransactionRow(transaction, actions = false) {
  const itemCategory = transaction.type === "transfer"
    ? { name: "Перевод", icon: "arrow-left-right", color: "#5e6f83" }
    : category(transaction.categoryId);
  const sign = transaction.type === "income" ? "+" : transaction.type === "expense" ? "−" : "";
  const amountClass = transaction.type === "income" ? "income-text" : transaction.type === "expense" ? "expense-text" : "neutral-text";
  return `<article class="transaction-row" data-transaction-id="${escapeHTML(transaction.id)}">
    <div class="transaction-icon" style="color:${escapeHTML(itemCategory.color)}">${transaction.type === "transfer" ? renderIcon("arrow-left-right") : `<i data-lucide="${escapeHTML(itemCategory.icon)}"></i>`}</div>
    <div class="transaction-main">
      <strong>${escapeHTML(transaction.description || itemCategory.name)}</strong>
      <small>${escapeHTML(itemCategory.name)} · ${escapeHTML(formatShortDate(transaction.date))} · ${escapeHTML(accountName(transaction.accountId))}</small>
    </div>
    <div class="transaction-amount">
      <strong class="${amountClass}">${sign}${safeMoney(transaction.amount)}</strong>
      <small>${transaction.status === "planned" ? "Запланировано" : transaction.type === "transfer" ? "Перевод" : transaction.type === "income" ? "Доход" : "Расход"}</small>
    </div>
    ${actions ? `<div class="transaction-actions">
      <button class="mini-button" type="button" data-action="edit" aria-label="Редактировать">${renderIcon("pencil")}<span>Изменить</span></button>
      <button class="mini-button" type="button" data-action="duplicate" aria-label="Дублировать">${renderIcon("copy")}<span>Копия</span></button>
      <button class="mini-button danger" type="button" data-action="delete" aria-label="Удалить">${renderIcon("trash-2")}<span>Удалить</span></button>
    </div>` : ""}
  </article>`;
}

function addCommonActionListeners() {
  view.querySelectorAll("[data-href]").forEach((button) => button.addEventListener("click", () => { location.hash = button.dataset.href; }));
}

function initializeOnboarding() {
  const root = document.getElementById("onboarding");
  if (settings().onboardingCompleted) return;
  root.hidden = false;
  document.body.style.overflow = "hidden";
  let step = 0;
  const state = {
    currency: "KZT",
    initialBalance: 350000,
    categories: ["Продукты", "Транспорт", "Жильё", "Кафе и рестораны", "Здоровье", "Зарплата"],
    demo: true,
  };
  const content = document.getElementById("onboarding-content");
  const next = document.getElementById("onboarding-next");
  const back = document.getElementById("onboarding-back");
  const progress = document.getElementById("onboarding-progress");

  const screens = [
    () => `<div class="onboarding-visual">${renderIcon("leaf")}</div>
      <p class="eyebrow">Личные финансы без лишнего шума</p>
      <h2 id="onboarding-title">Добро пожаловать в FinTrack</h2>
      <p class="onboarding-copy">Доходы, расходы, бюджеты и цели — в одном спокойном пространстве. Данные остаются на вашем устройстве.</p>`,
    () => `<p class="eyebrow">Шаг 2 из 5</p>
      <h2 id="onboarding-title">Выберите валюту</h2>
      <p class="onboarding-copy">Её можно будет изменить позже в настройках.</p>
      <div class="currency-grid">${Object.entries(CURRENCIES).map(([code, info]) => `<button class="choice-card ${state.currency === code ? "selected" : ""}" type="button" data-currency="${code}"><strong>${info.symbol} · ${code}</strong><small>${info.name}</small></button>`).join("")}</div>`,
    () => `<p class="eyebrow">Шаг 3 из 5</p>
      <h2 id="onboarding-title">Начальный баланс</h2>
      <p class="onboarding-copy">Укажите общую сумму, с которой хотите начать. Она будет распределена по демонстрационным счетам.</p>
      <div class="field" style="margin-top:28px"><label for="onboarding-balance">Сумма</label><div class="amount-input-wrap"><input id="onboarding-balance" inputmode="decimal" value="${state.initialBalance}"><span>${CURRENCIES[state.currency].symbol}</span></div></div>`,
    () => `<p class="eyebrow">Шаг 4 из 5</p>
      <h2 id="onboarding-title">Основные категории</h2>
      <p class="onboarding-copy">Отметьте то, чем пользуетесь чаще. Полный набор всё равно будет доступен.</p>
      <div class="choice-grid">${["Продукты", "Транспорт", "Жильё", "Кафе и рестораны", "Здоровье", "Зарплата", "Фриланс", "Путешествия"].map((name) => `<button class="choice-card ${state.categories.includes(name) ? "selected" : ""}" type="button" data-category-choice="${name}"><strong>${escapeHTML(name)}</strong><small>${state.categories.includes(name) ? "Выбрано" : "Нажмите, чтобы выбрать"}</small></button>`).join("")}</div>`,
    () => `<p class="eyebrow">Шаг 5 из 5</p>
      <h2 id="onboarding-title">Начать с примером?</h2>
      <p class="onboarding-copy">Демонстрационные данные помогут сразу увидеть аналитику, бюджеты и цели. Их можно удалить в настройках.</p>
      <div class="choice-grid">
        <button class="choice-card ${state.demo ? "selected" : ""}" type="button" data-demo="true"><strong>Добавить пример</strong><small>3 счёта, 30+ операций, цели и бюджеты</small></button>
        <button class="choice-card ${!state.demo ? "selected" : ""}" type="button" data-demo="false"><strong>Начать с нуля</strong><small>Только категории и основной счёт</small></button>
      </div>`,
  ];

  function renderStep() {
    content.innerHTML = screens[step]();
    progress.style.width = `${(step + 1) * 20}%`;
    back.hidden = step === 0;
    next.textContent = step === screens.length - 1 ? "Открыть FinTrack" : "Продолжить";
    refreshIcons(root);
    content.querySelectorAll("[data-currency]").forEach((button) => button.addEventListener("click", () => {
      state.currency = button.dataset.currency;
      renderStep();
    }));
    content.querySelectorAll("[data-category-choice]").forEach((button) => button.addEventListener("click", () => {
      const name = button.dataset.categoryChoice;
      state.categories = state.categories.includes(name) ? state.categories.filter((item) => item !== name) : [...state.categories, name];
      renderStep();
    }));
    content.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", () => {
      state.demo = button.dataset.demo === "true";
      renderStep();
    }));
  }

  function finish() {
    if (state.demo) initializeDemoData({ initialBalance: state.initialBalance, currency: state.currency, force: true });
    else initializeEmptyData({ initialBalance: state.initialBalance, currency: state.currency });
    saveSettings({ onboardingCompleted: true, currency: state.currency });
    saveAppState({ favoriteCategories: state.categories });
    applySettings();
    root.hidden = true;
    document.body.style.overflow = "";
    showToast("Настройки сохранены. Добро пожаловать!");
    renderRoute(currentRoute);
  }

  next.addEventListener("click", () => {
    if (step === 2) {
      const input = document.getElementById("onboarding-balance");
      state.initialBalance = parseAmount(input?.value);
    }
    if (step === screens.length - 1) finish();
    else {
      step += 1;
      renderStep();
    }
  });
  back.addEventListener("click", () => {
    step = Math.max(0, step - 1);
    renderStep();
  });
  document.getElementById("skip-onboarding").addEventListener("click", () => {
    state.demo = false;
    state.initialBalance = 0;
    finish();
  });
  renderStep();
}

function renderDashboard() {
  const appState = getAppState();
  const activePeriod = appState.selectedPeriod || "month";
  const summary = periodSummary(activePeriod);
  const totalBalance = getTotalBalance();
  const currentMonth = monthKey(todayISO());
  const previousDate = new Date();
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`;
  const monthlyTransactions = getAll("transactions");
  const currentNet = monthlyTransactions.filter((item) => monthKey(item.date) === currentMonth).reduce((value, item) => value + (item.type === "income" ? item.amount : item.type === "expense" ? -item.amount : 0), 0);
  const previousNet = monthlyTransactions.filter((item) => monthKey(item.date) === previousMonth).reduce((value, item) => value + (item.type === "income" ? item.amount : item.type === "expense" ? -item.amount : 0), 0);
  const change = previousNet ? ((currentNet - previousNet) / Math.abs(previousNet)) * 100 : 0;
  const hidden = settings().hideBalance;
  const latest = getAll("transactions").sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)).slice(0, 6);
  const budgets = getAll("budgets");
  const mainBudget = budgets[0];
  const mainProgress = mainBudget ? budgetProgress(mainBudget) : null;
  const goals = getAll("goals").filter((goal) => !goalProgress(goal).complete).slice(0, 2);
  const byCategory = analyticsSummary("month").byCategory.slice(0, 5);
  const totalCategories = byCategory.reduce((sum, [, amount]) => sum + amount, 0) || 1;

  page(`
    <div class="row-between">
      ${renderPeriodTabs(activePeriod, "dashboard-period")}
      <button class="button button-primary" type="button" data-href="#/transaction/new">${renderIcon("plus")}Добавить операцию</button>
    </div>
    <div class="overview-grid">
      <section class="balance-card">
        <div class="card-inner">
          <div class="row-between">
            <span class="balance-label">Текущий общий баланс</span>
            <button class="icon-button" id="toggle-balance" type="button" aria-label="${hidden ? "Показать суммы" : "Скрыть суммы"}">${renderIcon(hidden ? "eye" : "eye-off")}</button>
          </div>
          <div class="balance-value">${safeMoney(totalBalance, hidden)}</div>
          <div class="balance-details">
            <div class="balance-detail"><small>Доступно</small><strong>${safeMoney(totalBalance, hidden)}</strong></div>
            <div class="balance-detail"><small>Доходы</small><strong>${safeMoney(summary.income, hidden)}</strong></div>
            <div class="balance-detail"><small>Расходы</small><strong>${safeMoney(summary.expense, hidden)}</strong></div>
          </div>
        </div>
      </section>
      <section class="card card-pad snapshot-card">
        <div>
          <span class="balance-label muted">Чистый результат</span>
          <div class="snapshot-number">${safeMoney(summary.net, hidden)}</div>
          <span class="trend ${change < 0 ? "negative" : ""}">${renderIcon(change < 0 ? "trending-down" : "trending-up")} ${change >= 0 ? "+" : ""}${formatNumber(change, 1)}% к прошлому месяцу</span>
        </div>
        <div>
          <div class="row-between small"><span class="muted">Доля сбережений</span><strong>${summary.income ? formatNumber((summary.net / summary.income) * 100, 0) : 0}%</strong></div>
          <div class="progress" style="margin-top:8px"><span style="width:${clamp(summary.income ? (summary.net / summary.income) * 100 : 0, 0, 100)}%"></span></div>
        </div>
      </section>
    </div>
    <div class="metric-grid">
      <section class="card metric-card"><div class="metric-label"><span class="income"></span>Доходы за период</div><div class="metric-value income-text">${safeMoney(summary.income, hidden)}</div><small class="muted">${summary.count} операций учтено</small></section>
      <section class="card metric-card"><div class="metric-label"><span class="expense"></span>Расходы за период</div><div class="metric-value expense-text">${safeMoney(summary.expense, hidden)}</div><small class="muted">Среднее ${safeMoney(summary.expense / Math.max(1, new Date().getDate()), hidden)} в день</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Разница</div><div class="metric-value">${safeMoney(summary.net, hidden)}</div><small class="muted">${summary.net >= 0 ? "Положительный результат" : "Расходы выше доходов"}</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Активные цели</div><div class="metric-value">${goals.length}</div><small class="muted">${safeMoney(goals.reduce((sum, goal) => sum + goal.saved, 0), hidden)} накоплено</small></section>
    </div>
    <div class="content-grid">
      <section class="card card-pad">
        <div class="card-header"><div><h2>Последние операции</h2><p>Недавние движения по счетам</p></div><a class="mini-button" href="#/transactions">Все операции ${renderIcon("arrow-up-right")}</a></div>
        <div class="transaction-list">${latest.length ? latest.map((item) => renderTransactionRow(item)).join("") : renderEmpty("receipt-text", "Пока нет операций", "Добавьте первый доход или расход.", `<a class="button button-primary" href="#/transaction/new">Добавить</a>`)}</div>
      </section>
      <div class="section-stack">
        <section class="card card-pad">
          <div class="card-header"><div><h2>Расходы по категориям</h2><p>Текущий месяц</p></div></div>
          <div class="entity-list">${byCategory.length ? byCategory.map(([id, amount]) => {
            const item = category(id);
            const percent = amount / totalCategories * 100;
            return `<div><div class="row-between small"><span>${escapeHTML(item.name)}</span><strong>${safeMoney(amount, hidden)}</strong></div><div class="progress" style="margin-top:7px"><span style="width:${percent}%;background:${escapeHTML(item.color)}"></span></div></div>`;
          }).join("") : `<p class="muted small">Расходов пока нет.</p>`}</div>
        </section>
        <section class="card card-pad">
          <div class="card-header"><div><h2>Месячный бюджет</h2><p>${mainBudget ? escapeHTML(mainBudget.name) : "Бюджет не создан"}</p></div><a class="mini-button" href="#/budgets">${renderIcon("arrow-up-right")}</a></div>
          ${mainProgress ? `<div class="row-between"><strong class="entity-value">${safeMoney(mainProgress.spent, hidden)}</strong><span class="status-pill ${mainProgress.state === "exceeded" ? "danger" : mainProgress.state === "warning" ? "warning" : ""}">${formatNumber(mainProgress.percent)}%</span></div>
          <div class="progress ${mainProgress.state === "exceeded" ? "danger" : mainProgress.state === "warning" ? "warning" : ""}" style="margin:13px 0 9px"><span style="width:${mainProgress.displayPercent}%"></span></div>
          <div class="entity-meta"><span>Осталось ${safeMoney(mainProgress.remaining, hidden)}</span><span>${mainProgress.daysLeft} дн. до конца</span></div>` : renderEmpty("wallet-minimal", "Добавьте бюджет", "Лимит поможет держать расходы под контролем.", `<a class="button button-primary" href="#/budgets">Создать</a>`)}
        </section>
        ${goals.map((goal) => {
          const progress = goalProgress(goal);
          return `<section class="card card-pad">
            <div class="card-header"><div><h2>${escapeHTML(goal.name)}</h2><p>Финансовая цель</p></div><span class="status-pill">${formatNumber(progress.percent)}%</span></div>
            <div class="progress"><span style="width:${progress.displayPercent}%;background:${escapeHTML(goal.color)}"></span></div>
            <div class="entity-meta" style="margin-top:9px"><span>${safeMoney(goal.saved, hidden)}</span><span>из ${safeMoney(goal.target, hidden)}</span></div>
          </section>`;
        }).join("")}
      </div>
    </div>`);

  addCommonActionListeners();
  document.getElementById("toggle-balance").addEventListener("click", () => {
    updateSettings({ hideBalance: !settings().hideBalance });
    renderDashboard();
  });
  document.getElementById("dashboard-period").addEventListener("click", (event) => {
    const button = event.target.closest("[data-period]");
    if (!button) return;
    saveAppState({ selectedPeriod: button.dataset.period });
    renderDashboard();
  });
}

function transactionFormTemplate(transaction = null) {
  const isEdit = Boolean(transaction);
  const accounts = getAll("accounts").filter((account) => account.active !== false);
  const favorites = getAppState().favoriteCategories || [];
  const categories = getAll("categories")
    .filter((item) => item.active !== false)
    .sort((a, b) => {
      const aIndex = favorites.indexOf(a.name);
      const bIndex = favorites.indexOf(b.name);
      if (aIndex < 0 && bIndex < 0) return 0;
      if (aIndex < 0) return 1;
      if (bIndex < 0) return -1;
      return aIndex - bIndex;
    });
  const activeType = transaction?.type || "expense";
  const activeCategory = transaction?.categoryId || categories.find((item) => item.type === activeType)?.id || "";
  return `
    <form id="transaction-form" class="content-grid" novalidate>
      <section class="card card-pad">
        <div class="row-between">
          <div class="segmented" id="transaction-type" aria-label="Тип операции">
            ${[["expense", "Расход"], ["income", "Доход"], ["transfer", "Перевод"]].map(([type, label]) => `<button type="button" data-type="${type}" class="${activeType === type ? "active" : ""}">${label}</button>`).join("")}
          </div>
          <button class="mini-button" id="quick-mode-button" type="button" ${activeType === "transfer" ? "hidden" : ""}>${renderIcon("zap")} Быстрый режим</button>
        </div>
        <input type="hidden" name="type" value="${activeType}">
        <div class="field" style="margin-top:18px">
          <label for="amount">Сумма</label>
          <div class="amount-input-wrap"><input id="amount" name="amount" inputmode="decimal" autocomplete="off" value="${transaction ? escapeHTML(transaction.amount) : ""}" placeholder="0" required><span>${symbol()}</span></div>
          <span class="field-error" id="amount-error"></span>
        </div>
        <div class="field" id="category-field" style="margin-top:18px">
          <span class="field-label">Категория</span>
          <input type="hidden" name="categoryId" value="${escapeHTML(activeCategory)}">
          <div class="category-picker" id="category-picker">
            ${categories.filter((item) => item.type === activeType).map((item) => `<button class="category-chip ${item.id === activeCategory ? "selected" : ""}" type="button" data-category-id="${item.id}" data-category-type="${item.type}"><span>${renderIcon(item.icon)}</span><span>${escapeHTML(item.name)}</span></button>`).join("")}
          </div>
          <span class="field-error" id="category-error"></span>
        </div>
      </section>
      <section class="card card-pad">
        <div class="form-grid">
          <div class="field"><label for="accountId">Счёт</label><select id="accountId" name="accountId" required>${accounts.map((account) => `<option value="${account.id}" ${transaction?.accountId === account.id ? "selected" : ""}>${escapeHTML(account.name)} · ${safeMoney(getAccountBalance(account.id))}</option>`).join("")}</select></div>
          <div class="field" id="to-account-field" ${activeType !== "transfer" ? "hidden" : ""}><label for="toAccountId">На счёт</label><select id="toAccountId" name="toAccountId"><option value="">Выберите счёт</option>${accounts.map((account) => `<option value="${account.id}" ${transaction?.toAccountId === account.id ? "selected" : ""}>${escapeHTML(account.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="date">Дата</label><input id="date" name="date" type="date" value="${escapeHTML(transaction?.date || todayISO())}" required></div>
          <div class="field"><label for="time">Время</label><input id="time" name="time" type="time" value="${escapeHTML(transaction?.time || new Date().toTimeString().slice(0, 5))}"></div>
          <div class="field span-2"><label for="description">Описание</label><input id="description" name="description" maxlength="80" value="${escapeHTML(transaction?.description || "")}" placeholder="Например, продукты на неделю"></div>
          <div class="field span-2"><label for="note">Заметка</label><textarea id="note" name="note" maxlength="300" placeholder="Дополнительные детали">${escapeHTML(transaction?.note || "")}</textarea></div>
          <div class="field"><label for="tags">Теги</label><input id="tags" name="tags" value="${escapeHTML((transaction?.tags || []).join(", "))}" placeholder="дом, работа"></div>
          <div class="field"><label for="paymentMethod">Способ оплаты</label><select id="paymentMethod" name="paymentMethod"><option value="card">Карта</option><option value="cash">Наличные</option><option value="transfer">Перевод</option><option value="other">Другое</option></select></div>
          <div class="field"><label for="status">Статус</label><select id="status" name="status"><option value="completed">Завершена</option><option value="planned">Запланирована</option><option value="pending">Ожидает</option></select></div>
          <label class="setting-row span-2" for="recurring"><span><strong>Регулярная операция</strong><small>FinTrack будет проверять её при каждом запуске</small></span><span class="switch"><input id="recurring" name="recurring" type="checkbox" ${transaction?.recurring ? "checked" : ""}><span></span></span></label>
        </div>
        <div class="modal-actions">
          <a class="button button-secondary" href="#/transactions">Отмена</a>
          <button class="button button-primary" id="save-transaction" type="submit">${renderIcon("check")} ${isEdit ? "Сохранить изменения" : "Добавить операцию"}</button>
        </div>
      </section>
    </form>`;
}

function renderTransactionForm(route) {
  const id = route.params?.[1];
  const transaction = id ? getById("transactions", id) : null;
  if (id && !transaction) {
    renderNotFound();
    return;
  }
  if (transaction) {
    title.textContent = "Редактирование операции";
    eyebrow.textContent = "Измените нужные поля";
  }
  page(transactionFormTemplate(transaction));
  const form = document.getElementById("transaction-form");
  const typeField = form.elements.type;
  const categoryField = form.elements.categoryId;
  const categoryContainer = document.getElementById("category-field");
  const toAccountField = document.getElementById("to-account-field");
  const quickModeButton = document.getElementById("quick-mode-button");

  function renderCategoryOptions(type) {
    const categories = getAll("categories").filter((item) => item.active !== false && item.type === type);
    const selected = categories.some((item) => item.id === categoryField.value) ? categoryField.value : categories[0]?.id || "";
    categoryField.value = selected;
    document.getElementById("category-picker").innerHTML = categories.map((item) => `<button class="category-chip ${item.id === selected ? "selected" : ""}" type="button" data-category-id="${item.id}"><span>${renderIcon(item.icon)}</span><span>${escapeHTML(item.name)}</span></button>`).join("");
    refreshUIIcons();
  }

  document.getElementById("transaction-type").addEventListener("click", (event) => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    const type = button.dataset.type;
    typeField.value = type;
    document.querySelectorAll("#transaction-type button").forEach((item) => item.classList.toggle("active", item === button));
    categoryContainer.hidden = type === "transfer";
    toAccountField.hidden = type !== "transfer";
    quickModeButton.hidden = type === "transfer";
    if (type === "transfer") form.classList.remove("quick-mode");
    if (type !== "transfer") renderCategoryOptions(type);
  });

  quickModeButton.addEventListener("click", () => {
    const active = form.classList.toggle("quick-mode");
    quickModeButton.innerHTML = `${renderIcon(active ? "list-plus" : "zap")} ${active ? "Полная форма" : "Быстрый режим"}`;
    refreshUIIcons();
  });

  document.getElementById("category-picker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category-id]");
    if (!button) return;
    categoryField.value = button.dataset.categoryId;
    document.querySelectorAll(".category-chip").forEach((item) => item.classList.toggle("selected", item === button));
  });

  let submitting = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitting) return;
    const data = Object.fromEntries(new FormData(form));
    data.recurring = form.elements.recurring.checked;
    document.getElementById("amount-error").textContent = "";
    document.getElementById("category-error").textContent = "";
    if (parseAmount(data.amount) <= 0) {
      document.getElementById("amount-error").textContent = "Введите сумму больше нуля.";
      form.elements.amount.focus();
      return;
    }
    if (data.type !== "transfer" && !data.categoryId) {
      document.getElementById("category-error").textContent = "Выберите категорию.";
      return;
    }
    try {
      submitting = true;
      document.getElementById("save-transaction").disabled = true;
      const saved = transaction ? updateTransaction(transaction.id, data) : createTransaction(data);
      if (data.recurring && !transaction) {
        create("recurring", {
          type: data.type,
          amount: parseAmount(data.amount),
          categoryId: data.categoryId || null,
          accountId: data.accountId,
          description: data.description || "Регулярная операция",
          frequency: "monthly",
          interval: 1,
          day: new Date(`${data.date}T12:00:00`).getDate(),
          lastCreated: data.date,
          active: true,
        });
      }
      showToast(transaction ? "Операция обновлена." : "Операция добавлена.");
      location.hash = "#/transactions";
      return saved;
    } catch (error) {
      submitting = false;
      document.getElementById("save-transaction").disabled = false;
      showToast(error.message, { type: "error" });
    }
  });
}

function renderTransactions() {
  const categories = getAll("categories");
  const accounts = getAll("accounts");
  page(`
    <section class="card card-pad">
      <div class="card-header">
        <div><h2>Все операции</h2><p>${getAll("transactions").length} записей в локальной истории</p></div>
        <div class="row-between">
          <button class="mini-button" id="expand-filters" type="button">${renderIcon("sliders-horizontal")} Фильтры</button>
          <a class="button button-primary" href="#/transaction/new">${renderIcon("plus")} Добавить</a>
        </div>
      </div>
      <div class="filters" id="transaction-filters">
        <div class="field"><label for="transaction-search">Поиск</label><input id="transaction-search" type="search" placeholder="Описание, заметка или тег"></div>
        <div class="field"><label for="transaction-type-filter">Тип</label><select id="transaction-type-filter"><option value="all">Все типы</option><option value="expense">Расходы</option><option value="income">Доходы</option><option value="transfer">Переводы</option></select></div>
        <div class="field"><label for="transaction-category-filter">Категория</label><select id="transaction-category-filter"><option value="all">Все категории</option>${categories.map((item) => `<option value="${item.id}">${escapeHTML(item.name)} · ${item.type === "income" ? "доход" : "расход"}</option>`).join("")}</select></div>
        <div class="field"><label for="transaction-account-filter">Счёт</label><select id="transaction-account-filter"><option value="all">Все счета</option>${accounts.map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="transaction-period-filter">Период</label><select id="transaction-period-filter"><option value="all">Всё время</option><option value="today">Сегодня</option><option value="week">Неделя</option><option value="month">Месяц</option><option value="year">Год</option></select></div>
        <div class="field"><label for="transaction-min-filter">Сумма от</label><input id="transaction-min-filter" inputmode="decimal" placeholder="0"></div>
        <div class="field"><label for="transaction-max-filter">Сумма до</label><input id="transaction-max-filter" inputmode="decimal" placeholder="Без лимита"></div>
        <div class="field"><label for="transaction-sort">Сортировка</label><select id="transaction-sort"><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option></select></div>
      </div>
    </section>
    <section class="card card-pad">
      <div id="transactions-list"></div>
      <button class="button button-secondary button-block" id="load-more-transactions" type="button" hidden>Показать ещё</button>
    </section>`);

  const filters = document.getElementById("transaction-filters");
  const fields = {
    query: document.getElementById("transaction-search"),
    type: document.getElementById("transaction-type-filter"),
    categoryId: document.getElementById("transaction-category-filter"),
    accountId: document.getElementById("transaction-account-filter"),
    period: document.getElementById("transaction-period-filter"),
    min: document.getElementById("transaction-min-filter"),
    max: document.getElementById("transaction-max-filter"),
    sort: document.getElementById("transaction-sort"),
  };

  function drawList() {
    const data = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
    const items = filterTransactions(data);
    const shown = items.slice(0, transactionLimit);
    const list = document.getElementById("transactions-list");
    if (!shown.length) {
      list.innerHTML = renderEmpty("search-x", "Ничего не найдено", "Измените фильтры или добавьте новую операцию.", `<a class="button button-primary" href="#/transaction/new">Добавить операцию</a>`);
    } else {
      const groups = shown.reduce((map, item) => {
        (map[item.date] ||= []).push(item);
        return map;
      }, {});
      list.innerHTML = Object.entries(groups).map(([date, group]) => `<div class="search-group"><h3>${escapeHTML(formatDate(date, settings().dateFormat))}</h3><div class="transaction-list">${group.map((item) => renderTransactionRow(item, true)).join("")}</div></div>`).join("");
    }
    document.getElementById("load-more-transactions").hidden = shown.length >= items.length;
    refreshUIIcons();
  }

  const debouncedDraw = debounce(() => {
    transactionLimit = 18;
    drawList();
  });
  Object.values(fields).forEach((field) => field.addEventListener("input", debouncedDraw));
  document.getElementById("expand-filters").addEventListener("click", () => filters.classList.toggle("expanded"));
  document.getElementById("load-more-transactions").addEventListener("click", () => {
    transactionLimit += 18;
    drawList();
  });
  document.getElementById("transactions-list").addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    const row = event.target.closest("[data-transaction-id]");
    if (!action || !row) return;
    const id = row.dataset.transactionId;
    if (action.dataset.action === "edit") location.hash = `#/transaction/edit/${id}`;
    if (action.dataset.action === "duplicate") {
      duplicateTransaction(id);
      showToast("Создана копия операции.");
      drawList();
    }
    if (action.dataset.action === "delete") {
      const execute = () => {
        const deleted = deleteTransaction(id);
        drawList();
        showToast("Операция удалена.", {
          type: "info",
          actionLabel: "Отменить",
          onAction: () => {
            restoreTransaction(deleted);
            drawList();
            showToast("Операция восстановлена.");
          },
        });
      };
      if (settings().confirmDelete) confirmDialog({ title: "Удалить операцию?", message: "Она исчезнет из баланса и аналитики. Действие можно будет сразу отменить.", confirmLabel: "Удалить", danger: true, onConfirm: execute });
      else execute();
    }
  });
  drawList();
}

function budgetForm() {
  const categories = getAll("categories").filter((item) => item.type === "expense" && item.active !== false);
  const wrapper = document.createElement("form");
  wrapper.className = "form-grid";
  wrapper.innerHTML = `
    <div class="field span-2"><label for="budget-name">Название</label><input id="budget-name" name="name" maxlength="60" placeholder="Например, Основной бюджет" required></div>
    <div class="field"><label for="budget-limit">Лимит</label><input id="budget-limit" name="limit" inputmode="decimal" placeholder="150 000" required></div>
    <div class="field"><label for="budget-start">Дата начала</label><input id="budget-start" name="startDate" type="date" value="${todayISO()}"></div>
    <div class="field span-2"><label for="budget-categories">Категории</label><select id="budget-categories" name="categoryIds" multiple size="6"><option value="">Все расходы</option>${categories.map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join("")}</select><small class="muted">Оставьте без выбора для общего бюджета. Для нескольких категорий удерживайте Ctrl или ⌘.</small></div>
    <label class="setting-row span-2" for="budget-recurring"><span><strong>Автоматически повторять</strong><small>Бюджет будет актуален каждый месяц</small></span><span class="switch"><input id="budget-recurring" name="recurring" type="checkbox" checked><span></span></span></label>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">Создать бюджет</button></div>`;
  wrapper.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const selected = [...form.elements.categoryIds.selectedOptions].map((option) => option.value).filter(Boolean);
    const limit = parseAmount(form.elements.limit.value);
    if (!form.elements.name.value.trim() || !limit) {
      showToast("Укажите название и лимит бюджета.", { type: "error" });
      return;
    }
    createBudget({
      name: form.elements.name.value,
      limit,
      startDate: form.elements.startDate.value,
      categoryIds: selected,
      recurring: form.elements.recurring.checked,
    });
    closeModal();
    showToast("Бюджет создан.");
    renderBudgets();
  });
  return wrapper;
}

function renderBudgets() {
  const budgets = getAll("budgets");
  const alerts = activeBudgetAlerts();
  page(`
    <div class="section-header">
      <div><h2>Лимиты на текущий месяц</h2><p>Предупреждения появляются при 50%, 80% и 100% использования.</p></div>
      <button class="button button-primary" id="add-budget" type="button">${renderIcon("plus")} Новый бюджет</button>
    </div>
    ${alerts.some(({ progress }) => progress.percent >= 80) ? `<div class="security-note">${renderIcon("triangle-alert")} Некоторые бюджеты приближаются к лимиту. Проверьте прогнозы ниже.</div>` : ""}
    <div class="analytics-grid" id="budget-list">
      ${budgets.length ? budgets.map((budget) => {
        const progress = budgetProgress(budget);
        const categoryNames = budget.categoryIds?.length ? budget.categoryIds.map((id) => category(id).name).join(", ") : "Все категории расходов";
        const stateText = progress.state === "exceeded" ? "Превышен" : progress.state === "warning" ? "Близко к лимиту" : "В норме";
        return `<article class="card entity-card" data-id="${budget.id}">
          <div class="entity-card-header">
            <div class="entity-icon">${renderIcon("wallet-minimal")}</div>
            <div><h3>${escapeHTML(budget.name)}</h3><p>${escapeHTML(categoryNames)}</p></div>
            <span class="status-pill ${progress.state === "exceeded" ? "danger" : progress.state === "warning" ? "warning" : ""}">${stateText}</span>
          </div>
          <div class="row-between"><strong class="entity-value">${safeMoney(progress.spent)}</strong><span class="muted small">из ${safeMoney(budget.limit)}</span></div>
          <div class="progress ${progress.state === "exceeded" ? "danger" : progress.state === "warning" ? "warning" : ""}"><span style="width:${progress.displayPercent}%"></span></div>
          <div class="entity-meta"><span>Осталось: ${safeMoney(progress.remaining)}</span><span>${formatNumber(progress.percent, 0)}%</span></div>
          <div class="entity-meta"><span>Прогноз: ${safeMoney(progress.forecast)}</span><span>${progress.daysLeft} дн. до конца</span></div>
          <div class="row-between"><button class="mini-button" type="button" data-budget-action="edit">${renderIcon("pencil")} Изменить лимит</button><button class="mini-button danger" type="button" data-budget-action="delete">${renderIcon("trash-2")}</button></div>
        </article>`;
      }).join("") : renderEmpty("wallet-minimal", "Бюджетов пока нет", "Создайте общий или категорийный лимит на месяц.", `<button class="button button-primary" id="empty-add-budget" type="button">Создать бюджет</button>`)}
    </div>`);
  const open = () => showModal({ title: "Новый бюджет", eyebrow: "Контроль расходов", content: budgetForm() });
  document.getElementById("add-budget").addEventListener("click", open);
  document.getElementById("empty-add-budget")?.addEventListener("click", open);
  document.getElementById("budget-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-budget-action]");
    const card = event.target.closest("[data-id]");
    if (!button || !card) return;
    const budget = getById("budgets", card.dataset.id);
    if (button.dataset.budgetAction === "delete") {
      confirmDialog({ title: "Удалить бюджет?", message: "Операции останутся без изменений.", confirmLabel: "Удалить", danger: true, onConfirm: () => {
        remove("budgets", budget.id);
        renderBudgets();
        showToast("Бюджет удалён.", { type: "info" });
      } });
    } else {
      const form = document.createElement("form");
      form.className = "form-grid";
      form.innerHTML = `<div class="field span-2"><label for="edit-budget-limit">Новый лимит</label><input id="edit-budget-limit" inputmode="decimal" value="${budget.limit}"></div><div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">Сохранить</button></div>`;
      form.addEventListener("submit", (submitEvent) => {
        submitEvent.preventDefault();
        const limit = parseAmount(form.querySelector("input").value);
        if (!limit) return;
        update("budgets", budget.id, { limit });
        closeModal();
        renderBudgets();
        showToast("Лимит обновлён.");
      });
      showModal({ title: escapeHTML(budget.name), eyebrow: "Изменение бюджета", content: form });
    }
  });
}

function goalForm() {
  const form = document.createElement("form");
  form.className = "form-grid";
  const deadline = new Date();
  deadline.setMonth(deadline.getMonth() + 8);
  form.innerHTML = `
    <div class="field span-2"><label for="goal-name">Название цели</label><input id="goal-name" name="name" maxlength="60" placeholder="Например, Путешествие" required></div>
    <div class="field"><label for="goal-target">Целевая сумма</label><input id="goal-target" name="target" inputmode="decimal" required></div>
    <div class="field"><label for="goal-saved">Уже накоплено</label><input id="goal-saved" name="saved" inputmode="decimal" value="0"></div>
    <div class="field"><label for="goal-deadline">Крайний срок</label><input id="goal-deadline" name="deadline" type="date" value="${deadline.toISOString().slice(0, 10)}"></div>
    <div class="field"><label for="goal-icon">Иконка</label><select id="goal-icon" name="icon"><option value="target">Цель</option><option value="plane">Путешествие</option><option value="smartphone">Телефон</option><option value="car-front">Автомобиль</option><option value="graduation-cap">Обучение</option><option value="shield-check">Подушка</option></select></div>
    <div class="field"><label for="goal-color">Цвет</label><input id="goal-color" name="color" type="color" value="#4f7d61"></div>
    <div class="field span-2"><label for="goal-note">Заметка</label><textarea id="goal-note" name="note"></textarea></div>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">Создать цель</button></div>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim() || !parseAmount(data.target)) {
      showToast("Укажите название и целевую сумму.", { type: "error" });
      return;
    }
    createGoal({ ...data, target: parseAmount(data.target), saved: parseAmount(data.saved) });
    closeModal();
    renderGoals();
    showToast("Финансовая цель создана.");
  });
  return form;
}

function contributionForm(goal) {
  const form = document.createElement("form");
  form.className = "form-grid";
  const accounts = getAll("accounts").filter((item) => item.active !== false);
  form.innerHTML = `
    <div class="field span-2"><label for="goal-contribution">Сумма</label><input id="goal-contribution" name="amount" inputmode="decimal" placeholder="0" required></div>
    <div class="field"><label for="goal-operation">Действие</label><select id="goal-operation" name="operation"><option value="add">Внести средства</option><option value="subtract">Снять средства</option></select></div>
    <div class="field"><label for="goal-account">Источник</label><select id="goal-account" name="accountId"><option value="">Просто изменить сумму</option>${accounts.map((account) => `<option value="${account.id}">Списать с ${escapeHTML(account.name)}</option>`).join("")}</select></div>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">Сохранить</button></div>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const before = goalProgress(goal).complete;
      changeGoalSavings(goal.id, parseAmount(data.amount), data.operation, data.accountId || null);
      if (data.accountId && data.operation === "add") {
        createTransaction({
          type: "expense",
          amount: data.amount,
          categoryId: getAll("categories").find((item) => item.type === "expense" && item.name === "Другое")?.id,
          accountId: data.accountId,
          date: todayISO(),
          description: `Пополнение цели «${goal.name}»`,
          note: "Средства направлены в накопления",
          tags: ["цель"],
          status: "completed",
        });
      }
      const after = goalProgress(getById("goals", goal.id)).complete;
      closeModal();
      renderGoals();
      showToast(!before && after ? "Цель достигнута! Отличная работа." : "Сумма цели обновлена.", { title: !before && after ? "Поздравляем!" : "Готово" });
    } catch (error) {
      showToast(error.message, { type: "error" });
    }
  });
  return form;
}

function renderGoals() {
  const goals = getAll("goals");
  const active = goals.filter((goal) => !goalProgress(goal).complete);
  const complete = goals.filter((goal) => goalProgress(goal).complete);
  const renderCards = (items) => items.map((goal) => {
    const progress = goalProgress(goal);
    return `<article class="card entity-card ${progress.complete ? "goal-complete" : ""}" data-id="${goal.id}">
      <div class="entity-card-header">
        <div class="entity-icon" style="color:${escapeHTML(goal.color)}">${renderIcon(goal.icon || "target")}</div>
        <div><h3>${escapeHTML(goal.name)}</h3><p>${escapeHTML(goal.note || `Срок: ${formatDate(goal.deadline)}`)}</p></div>
        <span class="status-pill">${progress.complete ? "Достигнута" : `${formatNumber(progress.percent)}%`}</span>
      </div>
      <div class="row-between"><strong class="entity-value">${safeMoney(goal.saved)}</strong><span class="muted small">из ${safeMoney(goal.target)}</span></div>
      <div class="progress"><span style="width:${progress.displayPercent}%;background:${escapeHTML(goal.color)}"></span></div>
      <div class="entity-meta"><span>Осталось ${safeMoney(progress.remaining)}</span><span>Рекомендуется ${safeMoney(progress.recommendedMonthly)} / мес.</span></div>
      <div class="row-between"><button class="mini-button" type="button" data-goal-action="contribute">${renderIcon("plus")} Изменить сумму</button><button class="mini-button danger" type="button" data-goal-action="delete">${renderIcon("trash-2")}</button></div>
    </article>`;
  }).join("");
  page(`
    <div class="section-header"><div><h2>Ваши накопления</h2><p>${safeMoney(goals.reduce((sum, goal) => sum + goal.saved, 0))} распределено по целям</p></div><button class="button button-primary" id="add-goal" type="button">${renderIcon("plus")} Новая цель</button></div>
    <div class="analytics-grid" id="goal-list">${active.length ? renderCards(active) : renderEmpty("target", "Активных целей нет", "Создайте цель и начните регулярно откладывать.", `<button class="button button-primary" id="empty-add-goal" type="button">Создать цель</button>`)}</div>
    ${complete.length ? `<section><div class="section-header"><div><h2>Достигнутые цели</h2><p>Ваши завершённые накопления</p></div></div><div class="analytics-grid" style="margin-top:14px">${renderCards(complete)}</div></section>` : ""}`);
  const open = () => showModal({ title: "Новая финансовая цель", eyebrow: "План накоплений", content: goalForm() });
  document.getElementById("add-goal").addEventListener("click", open);
  document.getElementById("empty-add-goal")?.addEventListener("click", open);
  view.onclick = (event) => {
    const button = event.target.closest("[data-goal-action]");
    const card = event.target.closest("[data-id]");
    if (!button || !card) return;
    const goal = getById("goals", card.dataset.id);
    if (button.dataset.goalAction === "contribute") showModal({ title: goal.name, eyebrow: "Изменение накоплений", content: contributionForm(goal) });
    if (button.dataset.goalAction === "delete") confirmDialog({ title: "Удалить цель?", message: "История операций по счетам останется без изменений.", confirmLabel: "Удалить", danger: true, onConfirm: () => {
      remove("goals", goal.id);
      renderGoals();
      showToast("Цель удалена.", { type: "info" });
    } });
  };
}

function debtForm() {
  const form = document.createElement("form");
  form.className = "form-grid";
  const due = new Date();
  due.setMonth(due.getMonth() + 1);
  form.innerHTML = `
    <div class="field"><label for="debt-type">Вид</label><select id="debt-type" name="type"><option value="owed_to_me">Мне должны</option><option value="i_owe">Я должен</option></select></div>
    <div class="field"><label for="debt-person">Имя человека</label><input id="debt-person" name="person" required></div>
    <div class="field"><label for="debt-amount">Сумма</label><input id="debt-amount" name="amount" inputmode="decimal" required></div>
    <div class="field"><label for="debt-currency">Валюта</label><select id="debt-currency" name="currency">${Object.keys(CURRENCIES).map((code) => `<option value="${code}" ${code === settings().currency ? "selected" : ""}>${code} · ${CURRENCIES[code].symbol}</option>`).join("")}</select></div>
    <div class="field"><label for="debt-created">Дата создания</label><input id="debt-created" name="createdDate" type="date" value="${todayISO()}"></div>
    <div class="field"><label for="debt-due">Срок возврата</label><input id="debt-due" name="dueDate" type="date" value="${due.toISOString().slice(0, 10)}"></div>
    <div class="field span-2"><label for="debt-description">Описание</label><textarea id="debt-description" name="description"></textarea></div>
    <div class="field span-2"><label for="debt-contact">Телефон или контакт — необязательно</label><input id="debt-contact" name="contact" type="tel"></div>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">Добавить долг</button></div>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.person.trim() || !parseAmount(data.amount)) {
      showToast("Укажите имя и сумму долга.", { type: "error" });
      return;
    }
    createDebt({ ...data, amount: parseAmount(data.amount) });
    closeModal();
    renderDebts();
    showToast("Долг добавлен.");
  });
  return form;
}

function repaymentForm(debt) {
  const status = debtStatus(debt);
  const form = document.createElement("form");
  form.className = "form-grid";
  form.innerHTML = `
    <div class="field span-2"><label for="debt-payment">Сумма платежа</label><input id="debt-payment" inputmode="decimal" value="${status.remaining}" required></div>
    <p class="muted small span-2">Остаток долга: ${safeMoney(status.remaining)}</p>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">Сохранить платёж</button></div>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = parseAmount(form.querySelector("input").value);
    if (!amount) return;
    repayDebt(debt.id, amount);
    closeModal();
    renderDebts();
    showToast(amount >= status.remaining ? "Долг полностью погашен." : "Частичный платёж сохранён.");
  });
  return form;
}

function renderDebts() {
  const debts = getAll("debts");
  const filter = getAppState().debtFilter || "active";
  const visible = debts.filter((debt) => filter === "all" || (filter === "paid" ? debtStatus(debt).paid : !debtStatus(debt).paid));
  const owed = debts.filter((debt) => debt.type === "owed_to_me" && !debtStatus(debt).paid).reduce((sum, debt) => sum + debtStatus(debt).remaining, 0);
  const iOwe = debts.filter((debt) => debt.type === "i_owe" && !debtStatus(debt).paid).reduce((sum, debt) => sum + debtStatus(debt).remaining, 0);
  page(`
    <div class="metric-grid">
      <section class="card metric-card"><div class="metric-label"><span class="income"></span>Мне должны</div><div class="metric-value income-text">${safeMoney(owed)}</div><small class="muted">${debts.filter((debt) => debt.type === "owed_to_me" && !debtStatus(debt).paid).length} активных</small></section>
      <section class="card metric-card"><div class="metric-label"><span class="expense"></span>Я должен</div><div class="metric-value expense-text">${safeMoney(iOwe)}</div><small class="muted">${debts.filter((debt) => debt.type === "i_owe" && !debtStatus(debt).paid).length} активных</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Просрочено</div><div class="metric-value">${debts.filter((debt) => debtStatus(debt).overdue).length}</div><small class="muted">требуют внимания</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Погашено</div><div class="metric-value">${debts.filter((debt) => debtStatus(debt).paid).length}</div><small class="muted">в архиве</small></section>
    </div>
    <div class="section-header"><div class="segmented" id="debt-filter">${[["active", "Активные"], ["paid", "Архив"], ["all", "Все"]].map(([value, label]) => `<button type="button" data-filter="${value}" class="${filter === value ? "active" : ""}">${label}</button>`).join("")}</div><button class="button button-primary" id="add-debt" type="button">${renderIcon("plus")} Новый долг</button></div>
    <div class="analytics-grid" id="debt-list">
      ${visible.length ? visible.map((debt) => {
        const status = debtStatus(debt);
        return `<article class="card entity-card" data-id="${debt.id}">
          <div class="entity-card-header">
            <div class="entity-icon">${renderIcon(debt.type === "owed_to_me" ? "hand-coins" : "receipt-russian-ruble")}</div>
            <div><h3>${escapeHTML(debt.person)}</h3><p>${escapeHTML(debt.description || (debt.type === "owed_to_me" ? "Мне должны" : "Я должен"))}</p></div>
            <span class="status-pill ${status.overdue ? "danger" : status.paid ? "" : "warning"}">${status.paid ? "Погашен" : status.overdue ? "Просрочен" : "Активен"}</span>
          </div>
          <div class="row-between"><strong class="entity-value">${escapeHTML(formatMoney(status.remaining, debt.currency))}</strong><span class="muted small">из ${escapeHTML(formatMoney(debt.amount, debt.currency))}</span></div>
          <div class="progress ${status.overdue ? "danger" : ""}"><span style="width:${clamp((debt.repaid / debt.amount) * 100, 0, 100)}%"></span></div>
          <div class="entity-meta"><span>Срок: ${escapeHTML(formatDate(debt.dueDate))}</span><span>${debt.payments?.length || 0} платежей</span></div>
          <div class="row-between">${status.paid ? `<span class="muted small">В архиве</span>` : `<button class="mini-button" type="button" data-debt-action="repay">${renderIcon("circle-dollar-sign")} Погасить</button>`}<button class="mini-button danger" type="button" data-debt-action="delete">${renderIcon("trash-2")}</button></div>
        </article>`;
      }).join("") : renderEmpty("hand-coins", "Здесь пока пусто", "Добавьте долг или смените выбранный фильтр.", `<button class="button button-primary" id="empty-add-debt" type="button">Добавить долг</button>`)}
    </div>`);
  const open = () => showModal({ title: "Новый долг", eyebrow: "Учёт обязательств", content: debtForm() });
  document.getElementById("add-debt").addEventListener("click", open);
  document.getElementById("empty-add-debt")?.addEventListener("click", open);
  document.getElementById("debt-filter").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    saveAppState({ debtFilter: button.dataset.filter });
    renderDebts();
  });
  document.getElementById("debt-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-debt-action]");
    const card = event.target.closest("[data-id]");
    if (!button || !card) return;
    const debt = getById("debts", card.dataset.id);
    if (button.dataset.debtAction === "repay") showModal({ title: `Платёж — ${debt.person}`, eyebrow: "Погашение долга", content: repaymentForm(debt) });
    if (button.dataset.debtAction === "delete") confirmDialog({ title: "Удалить долг?", message: "История платежей этого долга также будет удалена.", confirmLabel: "Удалить", danger: true, onConfirm: () => {
      remove("debts", debt.id);
      renderDebts();
      showToast("Долг удалён.", { type: "info" });
    } });
  });
}

function categoryForm(existing = null) {
  const form = document.createElement("form");
  form.className = "form-grid";
  const iconOptions = ["shopping-basket", "bus-front", "house", "utensils", "heart-pulse", "shirt", "popcorn", "graduation-cap", "gift", "plane", "briefcase-business", "hand-coins", "shapes"];
  form.innerHTML = `
    <div class="field span-2"><label for="category-name">Название</label><input id="category-name" name="name" value="${escapeHTML(existing?.name || "")}" maxlength="50" required></div>
    <div class="field"><label for="category-type">Тип</label><select id="category-type" name="type"><option value="expense" ${existing?.type !== "income" ? "selected" : ""}>Расход</option><option value="income" ${existing?.type === "income" ? "selected" : ""}>Доход</option></select></div>
    <div class="field"><label for="category-icon">Иконка</label><select id="category-icon" name="icon">${iconOptions.map((icon) => `<option value="${icon}" ${existing?.icon === icon ? "selected" : ""}>${icon}</option>`).join("")}</select></div>
    <div class="field"><label for="category-color">Цвет</label><input id="category-color" name="color" type="color" value="${escapeHTML(existing?.color || "#5f796b")}"></div>
    <div class="field"><label for="category-limit">Личный лимит</label><input id="category-limit" name="limit" inputmode="decimal" value="${existing?.limit || 0}"></div>
    <label class="setting-row span-2" for="category-active"><span><strong>Активная категория</strong><small>Отображать при добавлении операции</small></span><span class="switch"><input id="category-active" name="active" type="checkbox" ${existing?.active !== false ? "checked" : ""}><span></span></span></label>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">${existing ? "Сохранить" : "Создать"}</button></div>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim()) return;
    const normalized = { ...data, limit: parseAmount(data.limit), active: form.elements.active.checked };
    if (existing) update("categories", existing.id, normalized);
    else create("categories", createCategory(normalized));
    closeModal();
    renderCategories();
    showToast(existing ? "Категория обновлена." : "Категория создана.");
  });
  return form;
}

function accountForm(existing = null) {
  const form = document.createElement("form");
  form.className = "form-grid";
  form.innerHTML = `
    <div class="field span-2"><label for="account-name">Название</label><input id="account-name" name="name" value="${escapeHTML(existing?.name || "")}" maxlength="50" required></div>
    <div class="field"><label for="account-type">Тип</label><select id="account-type" name="type"><option value="cash">Наличные</option><option value="card">Банковская карта</option><option value="deposit">Депозит</option><option value="wallet">Электронный кошелёк</option><option value="savings">Накопительный счёт</option><option value="other">Другой</option></select></div>
    <div class="field"><label for="account-balance">Начальный баланс</label><input id="account-balance" name="initialBalance" inputmode="decimal" value="${existing?.initialBalance || 0}"></div>
    <div class="field"><label for="account-currency">Валюта</label><select id="account-currency" name="currency">${Object.keys(CURRENCIES).map((code) => `<option value="${code}" ${existing?.currency === code || (!existing && settings().currency === code) ? "selected" : ""}>${code} · ${CURRENCIES[code].symbol}</option>`).join("")}</select></div>
    <div class="field"><label for="account-color">Цвет</label><input id="account-color" name="color" type="color" value="${escapeHTML(existing?.color || "#365f51")}"></div>
    <label class="setting-row span-2" for="account-total"><span><strong>Учитывать в общем балансе</strong><small>Отключите для технических или архивных счетов</small></span><span class="switch"><input id="account-total" name="includeInTotal" type="checkbox" ${existing?.includeInTotal !== false ? "checked" : ""}><span></span></span></label>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">${existing ? "Сохранить" : "Создать счёт"}</button></div>`;
  if (existing) form.elements.type.value = existing.type;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim()) return;
    const normalized = {
      ...data,
      initialBalance: parseAmount(data.initialBalance),
      includeInTotal: form.elements.includeInTotal.checked,
      icon: data.type === "cash" ? "wallet-cards" : data.type === "card" ? "credit-card" : data.type === "savings" ? "piggy-bank" : "landmark",
      active: existing?.active !== false,
    };
    if (existing) update("accounts", existing.id, normalized);
    else create("accounts", normalized);
    closeModal();
    renderCategories();
    showToast(existing ? "Счёт обновлён." : "Счёт создан.");
  });
  return form;
}

function accountHistory(account) {
  const transactions = getAll("transactions").filter((item) => item.accountId === account.id || item.toAccountId === account.id).sort((a, b) => b.date.localeCompare(a.date));
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `<div class="row-between"><span class="muted small">Текущий баланс</span><strong class="entity-value">${safeMoney(getAccountBalance(account.id))}</strong></div><div class="transaction-list" style="margin-top:16px">${transactions.length ? transactions.slice(0, 20).map((item) => renderTransactionRow(item)).join("") : renderEmpty("receipt-text", "История пуста", "По этому счёту ещё не было операций.")}</div>`;
  return wrapper;
}

function renderCategories() {
  const tab = getAppState().structureTab || "categories";
  const categories = getAll("categories");
  const accounts = getAll("accounts");
  const visibleCategories = [...categories].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ru"));
  page(`
    <div class="section-header">
      <div class="segmented" id="structure-tabs"><button type="button" data-tab="categories" class="${tab === "categories" ? "active" : ""}">Категории</button><button type="button" data-tab="accounts" class="${tab === "accounts" ? "active" : ""}">Счета</button></div>
      <button class="button button-primary" id="add-structure-item" type="button">${renderIcon("plus")} ${tab === "categories" ? "Категория" : "Счёт"}</button>
    </div>
    ${tab === "categories" ? `
      <section class="card card-pad">
        <div class="card-header"><div><h2>Категории доходов и расходов</h2><p>${categories.filter((item) => item.active).length} активных · ${categories.filter((item) => !item.active).length} скрытых</p></div></div>
        <div class="analytics-grid" id="category-list">${visibleCategories.map((item) => {
          const used = getAll("transactions").filter((transaction) => transaction.categoryId === item.id).length;
          return `<article class="menu-item" data-id="${item.id}" style="${item.active === false ? "opacity:.58" : ""}">
            <div class="entity-icon" style="color:${escapeHTML(item.color)}">${renderIcon(item.icon)}</div>
            <div><strong>${escapeHTML(item.name)}</strong><small>${item.type === "income" ? "Доход" : "Расход"} · ${used} операций${item.limit ? ` · лимит ${safeMoney(item.limit)}` : ""}</small></div>
            <div class="row-between"><button class="mini-button" type="button" data-category-action="edit" aria-label="Изменить">${renderIcon("pencil")}</button><button class="mini-button danger" type="button" data-category-action="delete" aria-label="Удалить">${renderIcon("trash-2")}</button></div>
          </article>`;
        }).join("")}</div>
      </section>` : `
      <div class="analytics-grid" id="account-list">${accounts.map((account) => `<article class="card entity-card" data-id="${account.id}" style="${account.active === false ? "opacity:.58" : ""}">
        <div class="entity-card-header">
          <div class="entity-icon" style="color:${escapeHTML(account.color)}">${renderIcon(account.icon || "wallet-cards")}</div>
          <div><h3>${escapeHTML(account.name)}</h3><p>${escapeHTML(account.type)} · ${escapeHTML(account.currency)}</p></div>
          <span class="status-pill ${account.active === false ? "warning" : ""}">${account.active === false ? "Архив" : account.includeInTotal === false ? "Не в балансе" : "Активен"}</span>
        </div>
        <div class="entity-value">${escapeHTML(formatMoney(getAccountBalance(account.id), account.currency))}</div>
        <div class="entity-meta"><span>Начальный: ${escapeHTML(formatMoney(account.initialBalance, account.currency))}</span><span>${getAll("transactions").filter((item) => item.accountId === account.id || item.toAccountId === account.id).length} операций</span></div>
        <div class="row-between"><button class="mini-button" type="button" data-account-action="history">${renderIcon("history")} История</button><div class="row-between"><button class="mini-button" type="button" data-account-action="edit">${renderIcon("pencil")}</button><button class="mini-button" type="button" data-account-action="archive">${renderIcon(account.active === false ? "archive-restore" : "archive")}</button></div></div>
      </article>`).join("")}</div>`}`);
  document.getElementById("structure-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    saveAppState({ structureTab: button.dataset.tab });
    renderCategories();
  });
  document.getElementById("add-structure-item").addEventListener("click", () => showModal({
    title: tab === "categories" ? "Новая категория" : "Новый счёт",
    eyebrow: tab === "categories" ? "Структура операций" : "Управление средствами",
    content: tab === "categories" ? categoryForm() : accountForm(),
  }));
  document.getElementById("category-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category-action]");
    const row = event.target.closest("[data-id]");
    if (!button || !row) return;
    const item = getById("categories", row.dataset.id);
    if (button.dataset.categoryAction === "edit") showModal({ title: item.name, eyebrow: "Редактирование категории", content: categoryForm(item) });
    if (button.dataset.categoryAction === "delete") {
      const used = getAll("transactions").some((transaction) => transaction.categoryId === item.id);
      confirmDialog({
        title: used ? "Категория используется" : "Удалить категорию?",
        message: used ? "Связанные операции будут перенесены в категорию «Другое» того же типа." : "Категорию нельзя будет восстановить.",
        confirmLabel: used ? "Перенести и удалить" : "Удалить",
        danger: true,
        onConfirm: () => {
          const fallback = getAll("categories").find((categoryItem) => categoryItem.name === "Другое" && categoryItem.type === item.type && categoryItem.id !== item.id);
          if (used && fallback) getAll("transactions").filter((transaction) => transaction.categoryId === item.id).forEach((transaction) => update("transactions", transaction.id, { categoryId: fallback.id }));
          remove("categories", item.id);
          renderCategories();
          showToast("Категория удалена.", { type: "info" });
        },
      });
    }
  });
  document.getElementById("account-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-account-action]");
    const card = event.target.closest("[data-id]");
    if (!button || !card) return;
    const account = getById("accounts", card.dataset.id);
    if (button.dataset.accountAction === "edit") showModal({ title: account.name, eyebrow: "Редактирование счёта", content: accountForm(account) });
    if (button.dataset.accountAction === "history") showModal({ title: account.name, eyebrow: "История счёта", content: accountHistory(account) });
    if (button.dataset.accountAction === "archive") {
      update("accounts", account.id, { active: account.active === false });
      renderCategories();
      showToast(account.active === false ? "Счёт восстановлен." : "Счёт перемещён в архив.", { type: "info" });
    }
  });
}

function chartOptions(currencyFormatter = true) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: getComputedStyle(document.documentElement).getPropertyValue("--muted"), boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } },
      tooltip: { callbacks: currencyFormatter ? { label: (context) => `${context.dataset.label || ""}: ${money(context.parsed.y ?? context.parsed)}` } : {} },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue("--muted"), font: { size: 11 } } },
      y: { grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--border") }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue("--muted"), font: { size: 10 }, callback: (value) => `${formatNumber(value / 1000)}k` } },
    },
  };
}

function createChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (!globalThis.Chart) {
    canvas.replaceWith(Object.assign(document.createElement("div"), { className: "empty-state", textContent: "График станет доступен после первой загрузки Chart.js." }));
    return;
  }
  chartInstances.push(new Chart(canvas, config));
}

function renderCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() || 7) - 1;
  const transactions = getAll("transactions");
  const recurringDays = new Set(getAll("recurring").filter((item) => item.active).map((item) => item.day));
  const debtDates = new Set(getAll("debts").filter((item) => debtStatus(item).overdue).map((item) => item.dueDate));
  const cells = new Array(leading).fill('<span class="calendar-day" aria-hidden="true"></span>');
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const items = transactions.filter((item) => item.date === date);
    const hasIncome = items.some((item) => item.type === "income");
    const hasExpense = items.some((item) => item.type === "expense");
    const hasRecurring = recurringDays.has(day);
    const overdue = debtDates.has(date);
    cells.push(`<button class="calendar-day ${items.length || hasRecurring || overdue ? "has-events" : ""}" type="button" data-calendar-date="${date}" aria-label="${day} ${new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(now)}: ${items.length} операций">
      ${day}<span class="event-dots">${hasIncome ? "<i></i>" : ""}${hasExpense ? '<i class="expense"></i>' : ""}${hasRecurring ? '<i style="background:var(--warning)"></i>' : ""}${overdue ? '<i style="background:var(--expense)"></i>' : ""}</span>
    </button>`);
  }
  return `<div class="calendar"><div class="calendar-head">Пн</div><div class="calendar-head">Вт</div><div class="calendar-head">Ср</div><div class="calendar-head">Чт</div><div class="calendar-head">Пт</div><div class="calendar-head">Сб</div><div class="calendar-head">Вс</div>${cells.join("")}</div>`;
}

function renderAnalytics() {
  const period = getAppState().analyticsPeriod || "year";
  const summary = analyticsSummary(period);
  const topCategory = category(summary.topCategoryId);
  const months = monthlySeries(7);
  const weekdays = weekdaySeries();
  const accounts = accountExpenseSeries();
  const categoryData = summary.byCategory.slice(0, 7);
  const previousMonth = new Date();
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const transactions = getAll("transactions");
  const currentKey = monthKey(todayISO());
  const previousKey = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}`;
  const compare = [currentKey, previousKey].map((key) => ({
    income: transactions.filter((item) => item.type === "income" && monthKey(item.date) === key).reduce((sum, item) => sum + item.amount, 0),
    expense: transactions.filter((item) => item.type === "expense" && monthKey(item.date) === key).reduce((sum, item) => sum + item.amount, 0),
  }));
  let running = getAll("accounts").reduce((sum, account) => sum + Number(account.initialBalance || 0), 0);
  const balances = months.income.map((income, index) => (running += income - months.expense[index]));
  page(`
    <div class="row-between">${renderPeriodTabs(period, "analytics-period")}<a class="mini-button" href="#/backup">${renderIcon("download")} Экспорт</a></div>
    <div class="metric-grid">
      <section class="card metric-card"><div class="metric-label"><span class="income"></span>Общий доход</div><div class="metric-value income-text">${safeMoney(summary.income)}</div><small class="muted">За выбранный период</small></section>
      <section class="card metric-card"><div class="metric-label"><span class="expense"></span>Общий расход</div><div class="metric-value expense-text">${safeMoney(summary.expense)}</div><small class="muted">${safeMoney(summary.averageDaily)} в день</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Чистый результат</div><div class="metric-value">${safeMoney(summary.net)}</div><small class="muted">Баланс: ${safeMoney(summary.balance)}</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Процент сбережений</div><div class="metric-value">${formatNumber(summary.savingsRate, 1)}%</div><small class="muted">${summary.income ? "Доходы минус расходы" : "Нет доходов для расчёта"}</small></section>
    </div>
    <div class="metric-grid">
      <section class="card metric-card"><div class="metric-label"><span></span>Крупнейшая трата</div><div class="metric-value">${safeMoney(summary.largestExpense?.amount || 0)}</div><small class="muted">${escapeHTML(summary.largestExpense?.description || "Нет данных")}</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Затратная категория</div><div class="metric-value">${escapeHTML(topCategory.name)}</div><small class="muted">${safeMoney(summary.byCategory[0]?.[1] || 0)}</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Операций</div><div class="metric-value">${summary.count}</div><small class="muted">Доходы, расходы и переводы</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Динамика баланса</div><div class="metric-value">${balances.at(-1) >= balances[0] ? "+" : ""}${formatNumber(((balances.at(-1) - balances[0]) / Math.max(1, Math.abs(balances[0]))) * 100, 1)}%</div><small class="muted">За ${months.labels.length} месяцев</small></section>
    </div>
    <div class="analytics-grid">
      <section class="card card-pad"><div class="card-header"><div><h2>Доходы и расходы</h2><p>По месяцам</p></div></div><div class="chart-wrap"><canvas id="income-expense-chart"></canvas></div></section>
      <section class="card card-pad"><div class="card-header"><div><h2>Расходы по категориям</h2><p>Структура выбранного периода</p></div></div><div class="chart-wrap"><canvas id="category-chart"></canvas></div></section>
      <section class="card card-pad"><div class="card-header"><div><h2>Динамика баланса</h2><p>Накопительный результат</p></div></div><div class="chart-wrap"><canvas id="balance-chart"></canvas></div></section>
      <section class="card card-pad"><div class="card-header"><div><h2>Расходы по дням недели</h2><p>Ваш ритм трат</p></div></div><div class="chart-wrap"><canvas id="weekday-chart"></canvas></div></section>
      <section class="card card-pad"><div class="card-header"><div><h2>Текущий и прошлый месяц</h2><p>Сравнение доходов и расходов</p></div></div><div class="chart-wrap"><canvas id="comparison-chart"></canvas></div></section>
      <section class="card card-pad"><div class="card-header"><div><h2>Расходы по счетам</h2><p>Распределение источников</p></div></div><div class="chart-wrap"><canvas id="account-chart"></canvas></div></section>
    </div>
    <section class="card card-pad">
      <div class="card-header"><div><h2>Финансовый календарь</h2><p>${new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date())}</p></div><div class="entity-meta"><span class="income-text">● Доход</span><span class="expense-text">● Расход</span></div></div>
      ${renderCalendar()}
    </section>`);
  document.getElementById("analytics-period").addEventListener("click", (event) => {
    const button = event.target.closest("[data-period]");
    if (!button) return;
    saveAppState({ analyticsPeriod: button.dataset.period });
    renderAnalytics();
  });
  view.querySelector(".calendar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-date]");
    if (!button) return;
    const date = button.dataset.calendarDate;
    const items = getAll("transactions").filter((item) => item.date === date);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = items.length ? `<div class="transaction-list">${items.map((item) => renderTransactionRow(item)).join("")}</div>` : renderEmpty("calendar-days", "Операций нет", "На этот день нет сохранённых операций.");
    showModal({ title: formatDate(date), eyebrow: "Финансовый календарь", content: wrapper });
  });
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  const income = getComputedStyle(document.documentElement).getPropertyValue("--income").trim();
  const expense = getComputedStyle(document.documentElement).getPropertyValue("--expense").trim();
  const neutral = getComputedStyle(document.documentElement).getPropertyValue("--neutral").trim();
  requestAnimationFrame(() => {
    createChart("income-expense-chart", { type: "bar", data: { labels: months.labels, datasets: [{ label: "Доходы", data: months.income, backgroundColor: income, borderRadius: 7 }, { label: "Расходы", data: months.expense, backgroundColor: expense, borderRadius: 7 }] }, options: chartOptions() });
    createChart("category-chart", { type: "doughnut", data: { labels: categoryData.map(([id]) => category(id).name), datasets: [{ data: categoryData.map(([, amount]) => amount), backgroundColor: categoryData.map(([id]) => category(id).color), borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { boxWidth: 9, usePointStyle: true, padding: 16, color: getComputedStyle(document.documentElement).getPropertyValue("--muted"), font: { size: 11 } } } } } });
    createChart("balance-chart", { type: "line", data: { labels: months.labels, datasets: [{ label: "Баланс", data: balances, borderColor: primary, backgroundColor: `${primary}22`, fill: true, tension: 0.35, pointRadius: 3 }] }, options: chartOptions() });
    createChart("weekday-chart", { type: "bar", data: { labels: weekdays.labels, datasets: [{ label: "Расходы", data: weekdays.values, backgroundColor: neutral, borderRadius: 8 }] }, options: chartOptions() });
    createChart("comparison-chart", { type: "bar", data: { labels: ["Текущий", "Прошлый"], datasets: [{ label: "Доходы", data: compare.map((item) => item.income), backgroundColor: income, borderRadius: 8 }, { label: "Расходы", data: compare.map((item) => item.expense), backgroundColor: expense, borderRadius: 8 }] }, options: chartOptions() });
    createChart("account-chart", { type: "doughnut", data: { labels: accounts.labels, datasets: [{ data: accounts.values, backgroundColor: getAll("accounts").map((account) => account.color), borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { boxWidth: 9, usePointStyle: true, color: getComputedStyle(document.documentElement).getPropertyValue("--muted"), font: { size: 11 } } } } } });
  });
}

function recurringForm() {
  const form = document.createElement("form");
  form.className = "form-grid";
  const accounts = getAll("accounts").filter((item) => item.active !== false);
  const categories = getAll("categories").filter((item) => item.active !== false);
  form.innerHTML = `
    <div class="field"><label for="rec-type">Тип</label><select id="rec-type" name="type"><option value="expense">Расход</option><option value="income">Доход</option></select></div>
    <div class="field"><label for="rec-amount">Сумма</label><input id="rec-amount" name="amount" inputmode="decimal" required></div>
    <div class="field"><label for="rec-category">Категория</label><select id="rec-category" name="categoryId">${categories.map((item) => `<option value="${item.id}" data-type="${item.type}" ${item.type === "income" ? "hidden" : ""}>${escapeHTML(item.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="rec-account">Счёт</label><select id="rec-account" name="accountId">${accounts.map((item) => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join("")}</select></div>
    <div class="field span-2"><label for="rec-description">Описание</label><input id="rec-description" name="description" placeholder="Например, Интернет" required></div>
    <div class="field"><label for="rec-frequency">Повторение</label><select id="rec-frequency" name="frequency"><option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option><option value="monthly" selected>Ежемесячно</option><option value="yearly">Ежегодно</option></select></div>
    <div class="field"><label for="rec-interval">Интервал</label><input id="rec-interval" name="interval" inputmode="numeric" value="1"></div>
    <div class="field"><label for="rec-day">День месяца</label><input id="rec-day" name="day" type="number" min="1" max="28" value="${new Date().getDate() > 28 ? 28 : new Date().getDate()}"></div>
    <div class="modal-actions span-2"><button class="button button-secondary" type="button" data-close-modal>Отмена</button><button class="button button-primary" type="submit">Добавить</button></div>`;
  form.elements.type.addEventListener("change", () => {
    const type = form.elements.type.value;
    [...form.elements.categoryId.options].forEach((option) => { option.hidden = option.dataset.type !== type; });
    form.elements.categoryId.value = [...form.elements.categoryId.options].find((option) => option.dataset.type === type)?.value || "";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!parseAmount(data.amount) || !data.description.trim()) {
      showToast("Укажите сумму и описание.", { type: "error" });
      return;
    }
    create("recurring", {
      ...data,
      amount: parseAmount(data.amount),
      interval: Math.max(1, Number(data.interval) || 1),
      day: clamp(data.day, 1, 28),
      lastCreated: todayISO(),
      active: true,
    });
    closeModal();
    renderMore();
    showToast("Регулярная операция добавлена.");
  });
  return form;
}

function renderMore() {
  const recurring = getAll("recurring");
  const automatic = getAll("transactions").filter((item) => item.recurringToken).slice(0, 5);
  const frequencyLabels = { daily: "Ежедневно", weekly: "Еженедельно", monthly: "Ежемесячно", yearly: "Ежегодно" };
  page(`
    <div class="analytics-grid">
      <section class="card card-pad">
        <div class="card-header"><div><h2>Разделы FinTrack</h2><p>Управление и дополнительные возможности</p></div></div>
        <div class="menu-list">
          ${[
            ["budgets", "Бюджеты", "Лимиты и прогноз расходов", "wallet-minimal"],
            ["goals", "Финансовые цели", "Накопления и ежемесячный план", "target"],
            ["debts", "Долги", "Обязательства и история платежей", "hand-coins"],
            ["categories", "Категории и счета", "Структура ваших финансов", "shapes"],
            ["backup", "Резервная копия", "JSON, CSV, импорт и восстановление", "database-backup"],
            ["settings", "Настройки", "Валюта, тема и персонализация", "settings-2"],
            ["about", "О приложении", "PWA, установка и конфиденциальность", "info"],
          ].map(([route, heading, copy, icon]) => `<a class="menu-item" href="#/${route}"><div class="entity-icon">${renderIcon(icon)}</div><div><strong>${heading}</strong><small>${copy}</small></div>${renderIcon("chevron-right")}</a>`).join("")}
        </div>
      </section>
      <section class="card card-pad">
        <div class="card-header"><div><h2>Регулярные операции</h2><p>Проверяются при каждом запуске</p></div><button class="mini-button" id="add-recurring" type="button">${renderIcon("plus")} Добавить</button></div>
        <div class="entity-list" id="recurring-list">${recurring.length ? recurring.map((item) => `<article class="menu-item" data-id="${item.id}">
          <div class="entity-icon">${renderIcon(item.type === "income" ? "trending-up" : "repeat-2")}</div>
          <div><strong>${escapeHTML(item.description)}</strong><small>${frequencyLabels[item.frequency] || "По интервалу"} · ${safeMoney(item.amount)} · последнее ${escapeHTML(formatDate(item.lastCreated))}</small></div>
          <button class="mini-button danger" type="button" data-recurring-delete aria-label="Удалить">${renderIcon("trash-2")}</button>
        </article>`).join("") : `<p class="muted small">Регулярных операций пока нет.</p>`}</div>
      </section>
    </div>
    ${automatic.length ? `<section class="card card-pad"><div class="card-header"><div><h2>Создано автоматически</h2><p>Последние регулярные операции</p></div></div><div class="transaction-list">${automatic.map((item) => renderTransactionRow(item)).join("")}</div></section>` : ""}`);
  document.getElementById("add-recurring").addEventListener("click", () => showModal({ title: "Регулярная операция", eyebrow: "Автоматизация", content: recurringForm() }));
  document.getElementById("recurring-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-recurring-delete]");
    const row = event.target.closest("[data-id]");
    if (!button || !row) return;
    confirmDialog({ title: "Удалить повторение?", message: "Уже созданные операции останутся в истории.", confirmLabel: "Удалить", danger: true, onConfirm: () => {
      remove("recurring", row.dataset.id);
      renderMore();
      showToast("Повторение удалено.", { type: "info" });
    } });
  });
}

function renderSettings() {
  const current = settings();
  page(`
    <div class="content-grid">
      <section class="card card-pad">
        <div class="card-header"><div><h2>Основные настройки</h2><p>Изменения сохраняются сразу</p></div></div>
        <div class="settings-section" id="settings-form">
          <label class="setting-row"><span><strong>Ваше имя</strong><small>Используется только внутри приложения</small></span><input class="search-input" id="setting-name" value="${escapeHTML(current.userName)}" maxlength="40"></label>
          <label class="setting-row"><span><strong>Основная валюта</strong><small>Для отображения сводных сумм</small></span><select class="search-input" id="setting-currency">${Object.entries(CURRENCIES).map(([code, info]) => `<option value="${code}" ${current.currency === code ? "selected" : ""}>${code} · ${info.symbol}</option>`).join("")}</select></label>
          <label class="setting-row"><span><strong>Формат даты</strong><small>В списках и карточках</small></span><select class="search-input" id="setting-date-format"><option value="DD.MM.YYYY" ${current.dateFormat === "DD.MM.YYYY" ? "selected" : ""}>ДД.ММ.ГГГГ</option><option value="YYYY-MM-DD" ${current.dateFormat === "YYYY-MM-DD" ? "selected" : ""}>ГГГГ-ММ-ДД</option></select></label>
          <label class="setting-row"><span><strong>Первый день недели</strong><small>Для календаря и отчётов</small></span><select class="search-input" id="setting-first-day"><option value="monday" ${current.firstDay === "monday" ? "selected" : ""}>Понедельник</option><option value="sunday" ${current.firstDay === "sunday" ? "selected" : ""}>Воскресенье</option></select></label>
        </div>
      </section>
      <section class="card card-pad">
        <div class="card-header"><div><h2>Внешний вид</h2><p>Комфортный режим на любом экране</p></div></div>
        <div class="settings-section">
          <label class="setting-row"><span><strong>Тема</strong><small>Светлая, тёмная или системная</small></span><select class="search-input" id="setting-theme"><option value="system" ${current.theme === "system" ? "selected" : ""}>Системная</option><option value="light" ${current.theme === "light" ? "selected" : ""}>Светлая</option><option value="dark" ${current.theme === "dark" ? "selected" : ""}>Тёмная</option></select></label>
          <label class="setting-row"><span><strong>Цвет интерфейса</strong><small>Акцент кнопок и навигации</small></span><select class="search-input" id="setting-accent"><option value="green" ${current.accent === "green" ? "selected" : ""}>Зелёный</option><option value="blue" ${current.accent === "blue" ? "selected" : ""}>Синий</option><option value="plum" ${current.accent === "plum" ? "selected" : ""}>Сливовый</option></select></label>
          <label class="setting-row" for="setting-hide-balance"><span><strong>Скрывать баланс</strong><small>Показывать •••••• вместо сумм</small></span><span class="switch"><input id="setting-hide-balance" type="checkbox" ${current.hideBalance ? "checked" : ""}><span></span></span></label>
          <label class="setting-row" for="setting-animations"><span><strong>Анимации</strong><small>Плавные переходы интерфейса</small></span><span class="switch"><input id="setting-animations" type="checkbox" ${current.animations ? "checked" : ""}><span></span></span></label>
          <label class="setting-row" for="setting-confirm-delete"><span><strong>Подтверждать удаление</strong><small>Защита от случайных действий</small></span><span class="switch"><input id="setting-confirm-delete" type="checkbox" ${current.confirmDelete ? "checked" : ""}><span></span></span></label>
        </div>
      </section>
    </div>
    <div class="analytics-grid">
      <section class="card card-pad">
        <div class="card-header"><div><h2>Демонстрационные данные</h2><p>Быстро посмотреть все возможности</p></div></div>
        <p class="muted small">Демонстрационный набор содержит счета, 30+ операций, бюджеты, цели, долги и регулярные платежи.</p>
        <button class="button button-secondary" id="reload-demo" type="button" style="margin-top:12px">${renderIcon("sparkles")} Загрузить демо заново</button>
      </section>
      <section class="card card-pad">
        <div class="card-header"><div><h2>Данные приложения</h2><p>Резервная копия перед сбросом рекомендуется</p></div></div>
        <div class="row-between"><a class="button button-secondary" href="#/backup">${renderIcon("database-backup")} Резервная копия</a><button class="button button-danger" id="reset-app" type="button">${renderIcon("rotate-ccw")} Сбросить</button></div>
      </section>
    </div>`);
  const bindings = [
    ["setting-name", "userName", "input"],
    ["setting-currency", "currency", "change"],
    ["setting-date-format", "dateFormat", "change"],
    ["setting-first-day", "firstDay", "change"],
    ["setting-theme", "theme", "change"],
    ["setting-accent", "accent", "change"],
    ["setting-hide-balance", "hideBalance", "change", true],
    ["setting-animations", "animations", "change", true],
    ["setting-confirm-delete", "confirmDelete", "change", true],
  ];
  bindings.forEach(([id, key, event, checked]) => {
    const element = document.getElementById(id);
    element.addEventListener(event, debounce(() => {
      updateSettings({ [key]: checked ? element.checked : element.value });
      if (!checked && event === "change") renderSettings();
      else showToast("Настройка сохранена.", { duration: 1800 });
    }, event === "input" ? 350 : 0));
  });
  document.getElementById("reload-demo").addEventListener("click", () => confirmDialog({
    title: "Заменить данные демонстрационными?",
    message: "Текущие счета, операции, бюджеты, цели и долги будут заменены. Сначала экспортируйте резервную копию, если они нужны.",
    confirmLabel: "Загрузить демо",
    danger: true,
    onConfirm: () => {
      initializeDemoData({ initialBalance: 350000, currency: settings().currency, force: true });
      renderSettings();
      showToast("Демонстрационные данные загружены.");
    },
  }));
  document.getElementById("reset-app").addEventListener("click", () => confirmDialog({
    title: "Сбросить FinTrack?",
    message: "Все локальные данные будут удалены. После сброса снова откроется приветствие.",
    confirmLabel: "Удалить всё",
    danger: true,
    onConfirm: () => {
      resetApplication();
      location.reload();
    },
  }));
}

function renderBackup() {
  const snapshot = exportAll();
  const backupCount = getAll("backups").length;
  page(`
    <div class="metric-grid">
      <section class="card metric-card"><div class="metric-label"><span></span>Операции</div><div class="metric-value">${snapshot.transactions.length}</div><small class="muted">готовы к экспорту</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Счета</div><div class="metric-value">${snapshot.accounts.length}</div><small class="muted">с балансами</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Цели и бюджеты</div><div class="metric-value">${snapshot.goals.length + snapshot.budgets.length}</div><small class="muted">активных записей</small></section>
      <section class="card metric-card"><div class="metric-label"><span></span>Локальные копии</div><div class="metric-value">${backupCount}</div><small class="muted">создаются перед импортом</small></section>
    </div>
    <div class="analytics-grid">
      <section class="card card-pad">
        <div class="card-header"><div><h2>Экспорт данных</h2><p>Сохраните копию на iCloud Drive или компьютер</p></div></div>
        <div class="menu-list">
          <button class="menu-item" id="export-json" type="button"><div class="entity-icon">${renderIcon("file-json")}</div><div><strong>Полная копия JSON</strong><small>Настройки, счета, операции, бюджеты, цели, долги и повторения</small></div>${renderIcon("share")}</button>
          <button class="menu-item" id="export-csv" type="button"><div class="entity-icon">${renderIcon("file-spreadsheet")}</div><div><strong>Операции в CSV</strong><small>Совместимо с Excel, Numbers и Google Sheets</small></div>${renderIcon("download")}</button>
        </div>
      </section>
      <section class="card card-pad">
        <div class="card-header"><div><h2>Импорт и восстановление</h2><p>Структура файла проверяется до замены</p></div></div>
        <div class="menu-list">
          <label class="menu-item" for="import-json" style="cursor:pointer"><div class="entity-icon">${renderIcon("file-up")}</div><div><strong>Импортировать JSON</strong><small>Перед заменой создаётся локальная копия</small></div>${renderIcon("chevron-right")}<input id="import-json" class="sr-only" type="file" accept="application/json,.json"></label>
          <button class="menu-item" id="restore-backup" type="button" ${backupCount ? "" : "disabled"}><div class="entity-icon">${renderIcon("history")}</div><div><strong>Восстановить последнюю копию</strong><small>${backupCount ? "Вернуть состояние до последнего импорта" : "Локальных копий пока нет"}</small></div>${renderIcon("rotate-ccw")}</button>
        </div>
      </section>
    </div>
    <div class="security-note">${renderIcon("shield-alert")} Файлы резервных копий содержат ваши финансовые записи в обычном JSON или CSV. Храните их в безопасном месте и не публикуйте открыто.</div>`);
  document.getElementById("export-json").addEventListener("click", async () => {
    await exportJSON();
    showToast("Экспорт JSON подготовлен.");
  });
  document.getElementById("export-csv").addEventListener("click", async () => {
    await exportCSV();
    showToast("CSV-файл подготовлен.");
  });
  document.getElementById("import-json").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const data = await readBackupFile(file);
      if (!validateData(data)) throw new Error("Структура файла не соответствует резервной копии FinTrack.");
      confirmDialog({
        title: "Заменить текущие данные?",
        message: "FinTrack создаст локальную копию текущего состояния, затем загрузит данные из выбранного файла.",
        confirmLabel: "Импортировать",
        danger: true,
        onConfirm: () => {
          try {
            importBackup(data);
            applySettings();
            renderBackup();
            showToast("Данные успешно импортированы.");
          } catch (error) {
            showToast(error.message, { type: "error" });
          }
        },
      });
    } catch (error) {
      showToast(error.message || "Не удалось прочитать файл.", { type: "error" });
    }
    event.target.value = "";
  });
  document.getElementById("restore-backup").addEventListener("click", () => confirmDialog({
    title: "Восстановить локальную копию?",
    message: "Текущее состояние будет заменено последней копией, созданной перед импортом.",
    confirmLabel: "Восстановить",
    danger: true,
    onConfirm: () => {
      try {
        restoreBackup();
        applySettings();
        renderBackup();
        showToast("Локальная копия восстановлена.");
      } catch (error) {
        showToast(error.message, { type: "error" });
      }
    },
  }));
}

function renderAbout() {
  page(`
    <div class="overview-grid">
      <section class="balance-card">
        <div class="card-inner">
          <div class="brand"><span class="brand-mark" style="background:white;color:var(--primary-strong)">F</span><span><strong style="font-size:22px">FinTrack</strong><small style="color:rgba(255,255,255,.7)">Personal Finance Manager</small></span></div>
          <div class="balance-value" style="white-space:normal;font-size:clamp(30px,5vw,48px)">Финансы под вашим контролем</div>
          <p style="max-width:560px;margin:0;color:rgba(255,255,255,.72)">Независимое PWA-приложение без регистрации и банковских подключений. Данные хранятся только в браузере на вашем устройстве.</p>
        </div>
      </section>
      <section class="card card-pad snapshot-card"><div><span class="eyebrow">Версия</span><div class="snapshot-number">1.0</div><p class="muted small">Создано Ruslan Toxeitov</p></div><a class="button button-secondary" href="https://github.com/Ruslanesliche" target="_blank" rel="noopener">${renderIcon("github")} GitHub автора</a></section>
    </div>
    <div class="analytics-grid">
      <section class="card card-pad">
        <div class="card-header"><div><h2>Установка на iPhone</h2><p>Системное окно нельзя открыть программно</p></div>${renderIcon("smartphone")}</div>
        <ol class="muted small" style="padding-left:20px;line-height:1.9">
          <li>Откройте приложение в Safari.</li>
          <li>Нажмите кнопку «Поделиться».</li>
          <li>Выберите «На экран Домой».</li>
          <li>Нажмите «Добавить».</li>
        </ol>
      </section>
      <section class="card card-pad">
        <div class="card-header"><div><h2>Установка на Android</h2><p>Поддерживаемые браузеры</p></div>${renderIcon("download")}</div>
        <p class="muted small">После первой загрузки основные функции доступны без интернета. Браузер может предложить установку автоматически.</p>
        <button class="button button-primary" id="install-pwa" type="button" ${deferredInstallPrompt ? "" : "disabled"}>${renderIcon("download")} ${deferredInstallPrompt ? "Установить FinTrack" : "Откройте меню браузера"}</button>
      </section>
    </div>
    <section class="card card-pad">
      <div class="card-header"><div><h2>Приватность и ограничения</h2><p>Честная локальная модель</p></div></div>
      <div class="security-note">FinTrack — клиентский трекер личных финансов. Приложение не связано с банками и не предназначено для хранения паролей, номеров карт или других чувствительных реквизитов.</div>
      <p class="muted small" style="margin-top:14px">Локальные данные не синхронизируются между устройствами автоматически. Очистка данных Safari удалит записи FinTrack, поэтому регулярно создавайте резервные копии. Внутренние предупреждения о бюджетах появляются при открытии приложения; системные push-уведомления не используются.</p>
    </section>`);
  document.getElementById("install-pwa").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderAbout();
  });
}

function renderNotFound() {
  page(`<section class="card">${renderEmpty("map-pin-off", "Страница не найдена", "Маршрут не существует или был перемещён.", `<a class="button button-primary" href="#/dashboard">Вернуться на главную</a>`)}</section>`);
}

function openGlobalSearch() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="field"><label for="global-search">Поиск по всему FinTrack</label><input class="search-input" id="global-search" type="search" placeholder="Операция, категория, счёт, долг, цель, заметка или тег" autocomplete="off"></div>
    <div id="search-history" class="search-group"></div>
    <div id="global-search-results" class="search-results"></div>`;
  function history() {
    const target = wrapper.querySelector("#search-history");
    const items = getAppState().searchHistory || [];
    target.innerHTML = items.length ? `<div class="row-between"><h3>Недавние запросы</h3><button class="text-button" id="clear-search-history" type="button">Очистить</button></div><div class="segmented">${items.map((item) => `<button type="button" data-history-query="${escapeHTML(item)}">${renderIcon("history")} ${escapeHTML(item)}</button>`).join("")}</div>` : "";
    target.querySelectorAll("[data-history-query]").forEach((button) => button.addEventListener("click", () => {
      wrapper.querySelector("#global-search").value = button.dataset.historyQuery;
      search(button.dataset.historyQuery);
    }));
    target.querySelector("#clear-search-history")?.addEventListener("click", () => {
      saveAppState({ searchHistory: [] });
      history();
    });
    refreshIcons(target);
  }
  function search(query) {
    const normalized = query.trim().toLocaleLowerCase("ru");
    const target = wrapper.querySelector("#global-search-results");
    if (!normalized) {
      target.innerHTML = "";
      return;
    }
    const categories = getAll("categories");
    const accounts = getAll("accounts");
    const transactions = getAll("transactions").filter((item) => [item.description, item.note, ...(item.tags || []), category(item.categoryId).name, accountName(item.accountId)].join(" ").toLocaleLowerCase("ru").includes(normalized)).slice(0, 8).map((item) => ({ type: "Операция", title: item.description || category(item.categoryId).name, meta: `${formatDate(item.date)} · ${money(item.amount)}`, href: `#/transaction/edit/${item.id}` }));
    const entities = [
      ...categories.filter((item) => item.name.toLocaleLowerCase("ru").includes(normalized)).slice(0, 4).map((item) => ({ type: "Категория", title: item.name, meta: item.type === "income" ? "Доход" : "Расход", href: "#/categories" })),
      ...accounts.filter((item) => item.name.toLocaleLowerCase("ru").includes(normalized)).slice(0, 4).map((item) => ({ type: "Счёт", title: item.name, meta: money(getAccountBalance(item.id)), href: "#/categories" })),
      ...getAll("debts").filter((item) => [item.person, item.description].join(" ").toLocaleLowerCase("ru").includes(normalized)).slice(0, 4).map((item) => ({ type: "Долг", title: item.person, meta: item.description, href: "#/debts" })),
      ...getAll("goals").filter((item) => [item.name, item.note].join(" ").toLocaleLowerCase("ru").includes(normalized)).slice(0, 4).map((item) => ({ type: "Цель", title: item.name, meta: money(item.saved), href: "#/goals" })),
    ];
    const results = [...transactions, ...entities];
    target.innerHTML = results.length ? `<div class="search-group"><h3>Результаты</h3>${results.map((item) => `<a class="search-result" href="${item.href}" data-search-result><span><strong>${escapeHTML(item.title)}</strong><small> · ${escapeHTML(item.type)}</small></span><small>${escapeHTML(item.meta || "")}</small></a>`).join("")}</div>` : renderEmpty("search-x", "Ничего не найдено", "Попробуйте другой запрос.");
    target.querySelectorAll("[data-search-result]").forEach((link) => link.addEventListener("click", () => {
      const entries = [query.trim(), ...(getAppState().searchHistory || []).filter((item) => item !== query.trim())].slice(0, 6);
      saveAppState({ searchHistory: entries });
      closeModal();
    }));
  }
  showModal({ title: "Глобальный поиск", eyebrow: "Все ваши записи", content: wrapper, onOpen: () => {
    history();
    const input = wrapper.querySelector("#global-search");
    input.addEventListener("input", debounce(() => search(input.value), 120));
    input.focus();
  } });
}

function renderRoute(route) {
  currentRoute = route;
  setPageMeta(route);
  if (route.name === "dashboard") renderDashboard();
  else if (route.name === "transactions") renderTransactions();
  else if (route.name === "transaction") renderTransactionForm(route);
  else if (route.name === "analytics") renderAnalytics();
  else if (route.name === "budgets") renderBudgets();
  else if (route.name === "goals") renderGoals();
  else if (route.name === "debts") renderDebts();
  else if (route.name === "categories") renderCategories();
  else if (route.name === "settings") renderSettings();
  else if (route.name === "backup") renderBackup();
  else if (route.name === "about") renderAbout();
  else if (route.name === "more") renderMore();
  else renderNotFound();
  updateActiveNavigation();
}

function registerPWA() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      showToast("Офлайн-режим станет доступен после публикации на HTTPS.", { type: "info" });
    });
  }
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
}

function initializeApp() {
  applySettings();
  bindSystemTheme();
  renderNavigation();
  initializeModal();
  document.getElementById("global-search-button").addEventListener("click", openGlobalSearch);
  document.getElementById("profile-button").addEventListener("click", () => { location.hash = "#/settings"; });
  const created = processRecurringOperations();
  if (created.length) showToast(`Автоматически создано операций: ${created.length}.`, { type: "info", title: "Регулярные платежи" });
  activeBudgetAlerts().filter(({ progress }) => progress.percent >= 80).slice(0, 1).forEach(({ budget, progress }) => {
    showToast(`${budget.name}: использовано ${formatNumber(progress.percent)}% лимита.`, { type: progress.percent >= 100 ? "error" : "warning", title: "Состояние бюджета", duration: 7_000 });
  });
  startRouter(renderRoute);
  initializeOnboarding();
  registerPWA();
  addEventListener("fintrack:datachange", () => {
    document.getElementById("profile-button").textContent = (settings().userName || "П").slice(0, 1).toLocaleUpperCase("ru");
  });
  document.getElementById("profile-button").textContent = (settings().userName || "П").slice(0, 1).toLocaleUpperCase("ru");
}

initializeApp();
