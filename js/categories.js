import { generateId } from "./utils.js";

export const DEFAULT_CATEGORIES = [
  ["Продукты", "shopping-basket", "#4f7d61", "expense"],
  ["Транспорт", "bus-front", "#58758f", "expense"],
  ["Жильё", "house", "#816855", "expense"],
  ["Коммунальные услуги", "lamp-wall-up", "#76704f", "expense"],
  ["Кафе и рестораны", "utensils", "#a05c55", "expense"],
  ["Здоровье", "heart-pulse", "#9b5963", "expense"],
  ["Одежда", "shirt", "#736780", "expense"],
  ["Развлечения", "popcorn", "#8c6e43", "expense"],
  ["Обучение", "graduation-cap", "#486d7d", "expense"],
  ["Подписки", "repeat-2", "#667189", "expense"],
  ["Подарки", "gift", "#9b607a", "expense"],
  ["Автомобиль", "car-front", "#5f6c63", "expense"],
  ["Путешествия", "plane", "#4e7d82", "expense"],
  ["Другое", "shapes", "#758078", "expense"],
  ["Зарплата", "briefcase-business", "#36775a", "income"],
  ["Подработка", "badge-dollar-sign", "#4d8266", "income"],
  ["Фриланс", "laptop", "#4f7185", "income"],
  ["Подарок", "gift", "#8b6680", "income"],
  ["Возврат долга", "hand-coins", "#6c7e52", "income"],
  ["Продажа", "tag", "#567a74", "income"],
  ["Инвестиции", "chart-candlestick", "#49695a", "income"],
  ["Другое", "shapes", "#758078", "income"],
].map(([name, icon, color, type], index) => ({
  id: `cat_${index + 1}`,
  name,
  icon,
  color,
  type,
  limit: 0,
  active: true,
  system: true,
}));

export function createCategory(data) {
  return {
    id: generateId("cat"),
    name: String(data.name || "Новая категория").trim(),
    icon: data.icon || "circle-dot",
    color: data.color || "#5f796b",
    type: data.type === "income" ? "income" : "expense",
    limit: Math.max(0, Number(data.limit) || 0),
    active: data.active !== false,
    system: false,
  };
}

export function categoryById(categories, id) {
  return categories.find((item) => item.id === id) || {
    id: "unknown",
    name: "Другое",
    icon: "shapes",
    color: "#758078",
    type: "expense",
  };
}
