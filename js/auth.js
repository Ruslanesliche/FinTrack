let client = null;
let currentSession = null;
let localMode = false;

function authScreen() {
  let screen = document.getElementById("auth-screen");
  if (screen) return screen;
  screen = document.createElement("div");
  screen.id = "auth-screen";
  screen.className = "auth-screen";
  screen.hidden = true;
  document.body.prepend(screen);
  return screen;
}

function setMessage(message, type = "info") {
  const element = document.getElementById("auth-message");
  if (!element) return;
  element.textContent = message || "";
  element.dataset.type = type;
  element.hidden = !message;
}

function setBusy(form, busy) {
  form.querySelectorAll("button, input").forEach((element) => {
    element.disabled = busy;
  });
}

function renderShell(content, title, subtitle) {
  const screen = authScreen();
  screen.hidden = false;
  screen.innerHTML = `
    <section class="auth-card" aria-labelledby="auth-title">
      <div class="auth-brand"><span class="brand-mark">F</span><strong>FinTrack</strong></div>
      <div class="auth-heading">
        <p class="eyebrow">Личный финансовый кабинет</p>
        <h1 id="auth-title">${title}</h1>
        <p>${subtitle}</p>
      </div>
      <div id="auth-message" class="auth-message" hidden></div>
      ${content}
      <p class="auth-security">Пароль обрабатывается защищённым сервисом авторизации и не хранится в базе FinTrack.</p>
    </section>`;
  return screen;
}

function renderLogin(message = "") {
  const screen = renderShell(`
    <form id="auth-form" class="auth-form">
      <label><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="name@example.com"></label>
      <label><span>Пароль</span><input name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="Минимум 8 символов"></label>
      <button class="button button-primary" type="submit">Войти</button>
    </form>
    <div class="auth-links">
      <button type="button" data-auth-view="register">Создать аккаунт</button>
      <button type="button" data-auth-view="forgot">Забыли пароль?</button>
    </div>`,
  "Вход по email",
  "Ваши данные синхронизируются только после входа.");
  bindViewLinks(screen);
  const form = screen.querySelector("#auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    setMessage("");
    const data = new FormData(form);
    const { error } = await client.auth.signInWithPassword({
      email: String(data.get("email")).trim(),
      password: String(data.get("password")),
    });
    if (error) {
      setBusy(form, false);
      setMessage("Не удалось войти. Проверьте email и пароль.", "error");
      return;
    }
    location.reload();
  });
  if (message) setMessage(message, "success");
}

function renderRegister() {
  const screen = renderShell(`
    <form id="auth-form" class="auth-form">
      <label><span>Имя</span><input name="name" type="text" autocomplete="name" maxlength="80" required placeholder="Как к вам обращаться"></label>
      <label><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="name@example.com"></label>
      <label><span>Пароль</span><input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Минимум 8 символов"></label>
      <button class="button button-primary" type="submit">Зарегистрироваться</button>
    </form>
    <div class="auth-links"><button type="button" data-auth-view="login">Уже есть аккаунт? Войти</button></div>`,
  "Создание аккаунта",
  "Используйте личный email — на него придёт подтверждение.");
  bindViewLinks(screen);
  const form = screen.querySelector("#auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    setMessage("");
    const data = new FormData(form);
    const email = String(data.get("email")).trim();
    const { data: result, error } = await client.auth.signUp({
      email,
      password: String(data.get("password")),
      options: {
        data: { full_name: String(data.get("name")).trim() },
        emailRedirectTo: `${location.origin}${location.pathname}`,
      },
    });
    setBusy(form, false);
    if (error) {
      setMessage(error.message || "Не удалось создать аккаунт.", "error");
      return;
    }
    if (result.session) {
      location.reload();
      return;
    }
    renderLogin(`Мы отправили письмо на ${email}. Подтвердите адрес, затем войдите.`);
  });
}

function renderForgot() {
  const screen = renderShell(`
    <form id="auth-form" class="auth-form">
      <label><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="name@example.com"></label>
      <button class="button button-primary" type="submit">Отправить ссылку</button>
    </form>
    <div class="auth-links"><button type="button" data-auth-view="login">Вернуться ко входу</button></div>`,
  "Восстановление доступа",
  "Пришлём безопасную ссылку для создания нового пароля.");
  bindViewLinks(screen);
  const form = screen.querySelector("#auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    const email = String(new FormData(form).get("email")).trim();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}`,
    });
    setBusy(form, false);
    setMessage(
      error ? "Не удалось отправить письмо. Попробуйте ещё раз." : "Если аккаунт существует, письмо уже отправлено.",
      error ? "error" : "success",
    );
  });
}

function renderPasswordUpdate() {
  const screen = renderShell(`
    <form id="auth-form" class="auth-form">
      <label><span>Новый пароль</span><input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Минимум 8 символов"></label>
      <button class="button button-primary" type="submit">Сохранить пароль</button>
    </form>`,
  "Новый пароль",
  "Придумайте пароль, который не используете в других сервисах.");
  const form = screen.querySelector("#auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    const password = String(new FormData(form).get("password"));
    const { error } = await client.auth.updateUser({ password });
    setBusy(form, false);
    if (error) {
      setMessage(error.message || "Не удалось изменить пароль.", "error");
      return;
    }
    history.replaceState({}, document.title, location.pathname);
    renderLogin("Пароль изменён. Теперь можно войти.");
  });
}

function renderConfigurationError() {
  renderShell(`
    <div class="auth-setup">
      <strong>Авторизация ещё не подключена</strong>
      <p>Добавьте SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY в окружение приложения.</p>
    </div>`,
  "FinTrack настраивается",
  "Экран регистрации готов, но ему нужны параметры проекта Supabase.");
}

function bindViewLinks(screen) {
  screen.querySelectorAll("[data-auth-view]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.authView === "register") renderRegister();
      else if (button.dataset.authView === "forgot") renderForgot();
      else renderLogin();
    });
  });
}

export async function initializeAuth() {
  if (location.protocol === "file:") {
    localMode = true;
    return { ready: true, local: true, user: null };
  }

  let config;
  try {
    const response = await fetch("/api/auth/config", { cache: "no-store" });
    if (response.status === 404) {
      localMode = true;
      return { ready: true, local: true, user: null };
    }
    if (!response.ok) throw new Error("auth_not_configured");
    config = await response.json();
  } catch {
    renderConfigurationError();
    return { ready: false, configured: false, user: null };
  }

  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });

  client.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    if (event === "PASSWORD_RECOVERY") renderPasswordUpdate();
  });

  const { data, error } = await client.auth.getSession();
  currentSession = data?.session || null;
  if (error || !currentSession) {
    renderLogin();
    return { ready: false, configured: true, user: null };
  }

  authScreen().hidden = true;
  return { ready: true, configured: true, user: currentSession.user };
}

export async function getAccessToken() {
  if (localMode) return null;
  const { data } = await client?.auth.getSession() || {};
  currentSession = data?.session || currentSession;
  return currentSession?.access_token || null;
}

export function getAuthUser() {
  return currentSession?.user || null;
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  location.reload();
}
