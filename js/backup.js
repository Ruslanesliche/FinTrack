import { exportAll, getAll, importAll, restoreLatestBackup } from "./storage.js";
import { downloadBlob, todayISO } from "./utils.js";

const MAX_BACKUP_BYTES = 2_000_000;

export function safeSpreadsheetCell(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/u.test(text.trimStart()) ? `'${text}` : text;
}

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  downloadBlob(blob, filename);
}

export async function exportJSON() {
  const content = JSON.stringify(exportAll(), null, 2);
  await shareOrDownload(new Blob([content], { type: "application/json" }), `fintrack-backup-${todayISO()}.json`, "Резервная копия FinTrack");
}

export async function exportCSV() {
  const headers = ["ID", "Тип", "Сумма", "Категория", "Счёт", "Дата", "Время", "Описание", "Заметка", "Теги", "Статус"];
  const categories = getAll("categories");
  const accounts = getAll("accounts");
  const quote = (value) => `"${safeSpreadsheetCell(value).replaceAll('"', '""')}"`;
  const rows = getAll("transactions").map((item) => [
    item.id,
    item.type,
    item.amount,
    categories.find((category) => category.id === item.categoryId)?.name || "",
    accounts.find((account) => account.id === item.accountId)?.name || "",
    item.date,
    item.time,
    item.description,
    item.note,
    (item.tags || []).join(", "),
    item.status,
  ].map(quote).join(";"));
  const csv = `\ufeff${headers.map(quote).join(";")}\r\n${rows.join("\r\n")}`;
  await shareOrDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `fintrack-transactions-${todayISO()}.csv`, "Операции FinTrack");
}

export async function readBackupFile(file) {
  if (!file || file.size > MAX_BACKUP_BYTES) {
    throw new Error("Файл резервной копии слишком большой. Максимальный размер — 2 МБ.");
  }
  const text = await file.text();
  const data = JSON.parse(text);
  return data;
}

export function importBackup(data) {
  return importAll(data);
}

export function restoreBackup() {
  return restoreLatestBackup();
}
