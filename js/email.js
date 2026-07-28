const INVISIBLE_EMAIL_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/gu;
const DOT_VARIANTS = /[\u3002\uFF0E\uFF61]/gu;

export function normalizeEmail(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE_EMAIL_CHARACTERS, "")
    .replace(DOT_VARIANTS, ".")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function friendlyAuthError(error, fallback) {
  const code = String(error?.code || "").toLowerCase();
  const originalMessage = String(error?.message || "").replace(/\s+/gu, " ").trim();
  const message = originalMessage.toLowerCase();
  const status = Number(error?.status || 0);

  if (
    ["email_exists", "user_already_exists"].includes(code)
    || message.includes("already registered")
    || message.includes("already exists")
  ) {
    return "Не удалось завершить регистрацию. Если этот email уже использовался, попробуйте войти или восстановить пароль.";
  }

  if (
    code === "weak_password"
    || (message.includes("password") && (message.includes("weak") || message.includes("least")))
  ) {
    return "Сервис отклонил пароль как слишком простой. Придумайте более длинный и уникальный вариант.";
  }

  if (code === "email_address_not_authorized") {
    return "Отправка писем доступна только участникам проекта. Включите Custom SMTP в Supabase.";
  }

  if (code === "email_address_invalid" || (message.includes("email") && message.includes("invalid"))) {
    return "Сервис авторизации отклонил этот email. Введите адрес вручную и проверьте настройки SMTP в Supabase (код: email_address_invalid).";
  }

  if (code === "over_email_send_rate_limit" || message.includes("rate limit")) {
    return "Слишком много писем за короткое время. Подождите несколько минут и попробуйте снова.";
  }

  if (code === "email_provider_disabled") {
    return "Регистрация по email отключена в Supabase. Включите Email provider.";
  }

  if (code === "anonymous_provider_disabled") {
    return "Форма не передала email в сервис авторизации. Обновите FinTrack до последней версии и попробуйте снова.";
  }

  if (status >= 500 || code === "unexpected_failure") {
    return "Не удалось отправить письмо подтверждения. Проверьте SMTP в Supabase и попробуйте снова.";
  }

  return fallback;
}
