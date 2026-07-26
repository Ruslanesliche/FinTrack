let previousFocus = null;

export function refreshIcons(root = document) {
  if (globalThis.lucide?.createIcons) globalThis.lucide.createIcons({ attrs: { "aria-hidden": "true", "stroke-width": 1.8 }, root });
}

export function showToast(message, options = {}) {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");
  toast.className = `toast ${options.type || "success"}`;
  const icon = document.createElement("div");
  icon.className = "toast-icon";
  icon.innerHTML = `<i data-lucide="${options.type === "error" ? "circle-alert" : options.type === "warning" ? "triangle-alert" : options.type === "info" ? "info" : "circle-check"}"></i>`;
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = options.title || (options.type === "error" ? "Ошибка" : options.type === "warning" ? "Обратите внимание" : "Готово");
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  copy.append(title, paragraph);
  toast.append(icon, copy);
  if (options.actionLabel && options.onAction) {
    const action = document.createElement("button");
    action.className = "mini-button";
    action.type = "button";
    action.textContent = options.actionLabel;
    action.addEventListener("click", () => {
      options.onAction();
      toast.remove();
    });
    toast.append(action);
  }
  region.append(toast);
  refreshIcons(toast);
  setTimeout(() => toast.remove(), options.duration || 4_500);
}

function focusableElements(container) {
  return [...container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
}

function handleModalKeys(event) {
  const modal = document.getElementById("modal-root");
  if (event.key === "Escape") closeModal();
  if (event.key !== "Tab") return;
  const items = focusableElements(modal);
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function showModal({ title, eyebrow = "FinTrack", content, onOpen }) {
  const root = document.getElementById("modal-root");
  previousFocus = document.activeElement;
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-eyebrow").textContent = eyebrow;
  const target = document.getElementById("modal-content");
  target.replaceChildren();
  if (content instanceof Node) target.append(content);
  else target.innerHTML = String(content || "");
  root.hidden = false;
  document.body.style.overflow = "hidden";
  root.addEventListener("keydown", handleModalKeys);
  refreshIcons(root);
  requestAnimationFrame(() => (focusableElements(root)[0] || root).focus());
  if (onOpen) onOpen(target);
}

export function closeModal() {
  const root = document.getElementById("modal-root");
  root.hidden = true;
  document.body.style.overflow = "";
  root.removeEventListener("keydown", handleModalKeys);
  if (previousFocus instanceof HTMLElement) previousFocus.focus();
}

export function confirmDialog({ title, message, confirmLabel = "Подтвердить", danger = false, onConfirm }) {
  const content = document.createElement("div");
  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = message;
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.className = "button button-secondary";
  cancel.type = "button";
  cancel.textContent = "Отмена";
  cancel.addEventListener("click", closeModal);
  const confirm = document.createElement("button");
  confirm.className = `button ${danger ? "button-danger" : "button-primary"}`;
  confirm.type = "button";
  confirm.textContent = confirmLabel;
  confirm.addEventListener("click", () => {
    closeModal();
    onConfirm?.();
  });
  actions.append(cancel, confirm);
  content.append(paragraph, actions);
  showModal({ title, eyebrow: danger ? "Требуется подтверждение" : "Подтверждение", content });
}

export function initializeModal() {
  document.getElementById("modal-root").addEventListener("click", (event) => {
    if (event.target.closest("[data-close-modal]")) closeModal();
  });
}
