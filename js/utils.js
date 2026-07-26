export const CURRENCIES = {
  KZT: { symbol: "₸", name: "Казахстанский тенге" },
  USD: { symbol: "$", name: "Доллар США" },
  EUR: { symbol: "€", name: "Евро" },
  RUB: { symbol: "₽", name: "Российский рубль" },
  CNY: { symbol: "¥", name: "Китайский юань" },
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function generateId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseAmount(value) {
  const normalized = String(value ?? "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}

export function formatMoney(value, currency = "KZT", hidden = false) {
  if (hidden) return "••••••";
  const amount = Number(value) || 0;
  const locale = currency === "USD" ? "en-US" : currency === "EUR" ? "de-DE" : "ru-RU";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "KZT" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString("ru-RU")} ${CURRENCIES[currency]?.symbol || currency}`;
  }
}

export function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(Number(value) || 0);
}

export function formatDate(value, format = "DD.MM.YYYY") {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  if (format === "YYYY-MM-DD") return date.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatShortDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

export function monthKey(value) {
  return String(value || "").slice(0, 7);
}

export function startOfPeriod(period = "month", reference = new Date()) {
  const date = new Date(reference);
  date.setHours(0, 0, 0, 0);
  if (period === "today") return date;
  if (period === "week") {
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }
  if (period === "year") {
    date.setMonth(0, 1);
    return date;
  }
  date.setDate(1);
  return date;
}

export function endOfPeriod(period = "month", reference = new Date()) {
  const start = startOfPeriod(period, reference);
  if (period === "today") return new Date(start.getTime() + 86_399_999);
  if (period === "week") return new Date(start.getTime() + 7 * 86_400_000 - 1);
  if (period === "year") return new Date(start.getFullYear() + 1, 0, 1, 0, 0, 0, -1);
  return new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, -1);
}

export function inPeriod(dateValue, period = "month", custom = {}) {
  const date = new Date(`${dateValue}T12:00:00`);
  const start = custom.from ? new Date(`${custom.from}T00:00:00`) : startOfPeriod(period);
  const end = custom.to ? new Date(`${custom.to}T23:59:59`) : endOfPeriod(period);
  return date >= start && date <= end;
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function debounce(callback, delay = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function daysUntil(value) {
  const date = new Date(`${value}T23:59:59`);
  return Math.ceil((date - new Date()) / 86_400_000);
}

export function renderIcon(name, label = "") {
  return `<i data-lucide="${escapeHTML(name)}"${label ? ` aria-label="${escapeHTML(label)}"` : ""}></i>`;
}
