import { getSettings, saveSettings } from "./storage.js";

export function resolveTheme(theme) {
  if (theme === "system") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return theme;
}

export function applySettings() {
  const settings = getSettings();
  document.documentElement.dataset.theme = resolveTheme(settings.theme);
  document.documentElement.dataset.accent = settings.accent;
  document.documentElement.classList.toggle("reduce-motion", settings.animations === false);
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = resolveTheme(settings.theme) === "dark" ? "#101612" : "#f3f6f3";
  return settings;
}

export function updateSettings(patch) {
  const settings = saveSettings(patch);
  applySettings();
  return settings;
}

export function bindSystemTheme() {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getSettings().theme === "system") applySettings();
  });
}
