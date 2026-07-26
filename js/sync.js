import { exportAll, importAll, resetApplication, validateData } from "./storage.js";
import { getAccessToken } from "./auth.js";

const META_KEY = "fintrack_sync_meta";
const REQUEST_TIMEOUT = 5_000;
const SYNC_DELAY = 1_200;

let syncTimer = null;
let syncing = false;
let started = false;
let state = {
  status: "connecting",
  user: null,
  revision: 0,
  lastSyncedAt: null,
  message: "Подключение к облаку…",
};

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) || {};
  } catch {
    return {};
  }
}

function writeMeta(patch) {
  const next = { ...readMeta(), ...patch };
  localStorage.setItem(META_KEY, JSON.stringify(next));
  return next;
}

function publish(patch) {
  state = { ...state, ...patch };
  window.dispatchEvent(new CustomEvent("fintrack:syncchange", { detail: state }));
  return state;
}

function hasUserData(snapshot) {
  return [
    snapshot.accounts,
    snapshot.transactions,
    snapshot.budgets,
    snapshot.goals,
    snapshot.debts,
  ].some((items) => Array.isArray(items) && items.length > 0);
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const accessToken = await getAccessToken();
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        accept: "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function markSynced(snapshot, user = state.user) {
  const now = new Date().toISOString();
  writeMeta({
    revision: snapshot.revision,
    lastSyncedAt: now,
    localUpdatedAt: now,
    serverUpdatedAt: snapshot.updatedAt || now,
  });
  return publish({
    status: "synced",
    user,
    revision: snapshot.revision,
    lastSyncedAt: now,
    message: "Данные синхронизированы",
  });
}

async function pushSnapshot({ expectedRevision } = {}) {
  if (syncing || !navigator.onLine) return state;
  syncing = true;
  publish({ status: "syncing", message: "Сохраняем изменения…" });
  const meta = readMeta();
  try {
    const snapshot = await request("/api/sync", {
      method: "PUT",
      body: JSON.stringify({
        data: exportAll(),
        expectedRevision: expectedRevision ?? meta.revision ?? 0,
        clientUpdatedAt: meta.localUpdatedAt || new Date().toISOString(),
      }),
    });
    return markSynced(snapshot);
  } catch (error) {
    if (error.status === 409) {
      return publish({
        status: "conflict",
        message: "Есть изменения с другого устройства",
      });
    }
    return publish({
      status: navigator.onLine ? "error" : "offline",
      message: navigator.onLine ? "Не удалось синхронизировать" : "Офлайн — изменения сохранены",
    });
  } finally {
    syncing = false;
  }
}

function importServerSnapshot(remote) {
  window.__fintrackSyncImporting = true;
  try {
    importAll(remote.data);
  } finally {
    window.__fintrackSyncImporting = false;
  }
  markSynced(remote);
}

export function getSyncState() {
  return { ...state };
}

export async function initializeCloudSync() {
  if (location.protocol === "file:") {
    return publish({
      status: "local",
      message: "Локальный режим",
    });
  }

  try {
    const session = await request("/api/session");
    state.user = session.user;
    const knownOwner = readMeta().ownerEmail;
    if (knownOwner && knownOwner !== session.user.email) {
      resetApplication();
      writeMeta({
        ownerEmail: session.user.email,
        revision: 0,
        lastSyncedAt: null,
        localUpdatedAt: null,
        serverUpdatedAt: null,
      });
    } else {
      writeMeta({ ownerEmail: session.user.email });
    }
    const remote = await request("/api/sync");
    const local = exportAll();
    const meta = readMeta();
    const localDirty = Boolean(
      meta.localUpdatedAt
      && (!meta.lastSyncedAt || meta.localUpdatedAt > meta.lastSyncedAt),
    );

    if (remote.data && validateData(remote.data)) {
      if (!meta.lastSyncedAt || (remote.revision > (meta.revision || 0) && !localDirty)) {
        importServerSnapshot(remote);
      } else if (remote.revision > (meta.revision || 0) && localDirty) {
        publish({
          status: "conflict",
          user: session.user,
          revision: meta.revision || 0,
          message: "Есть изменения с другого устройства",
        });
      } else if (localDirty) {
        await pushSnapshot({ expectedRevision: meta.revision || 0 });
      } else {
        markSynced(remote, session.user);
      }
    } else if (hasUserData(local)) {
      await pushSnapshot({ expectedRevision: 0 });
    } else {
      publish({
        status: "ready",
        user: session.user,
        revision: 0,
        message: "Облако готово к синхронизации",
      });
    }
  } catch (error) {
    publish({
      status: error.status === 401 ? "signed-out" : navigator.onLine ? "error" : "offline",
      message: error.status === 401
        ? "Войдите, чтобы синхронизировать"
        : navigator.onLine
          ? "Облако временно недоступно"
          : "Офлайн — данные на устройстве",
    });
  }

  return state;
}

export function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    pushSnapshot();
  }, SYNC_DELAY);
}

export async function syncNow() {
  clearTimeout(syncTimer);
  return pushSnapshot();
}

export async function deleteCloudSnapshot() {
  clearTimeout(syncTimer);
  if (location.protocol === "file:" || !state.user || state.status === "signed-out") return true;
  await request("/api/sync", { method: "DELETE" });
  const now = new Date().toISOString();
  writeMeta({
    revision: 0,
    lastSyncedAt: now,
    localUpdatedAt: now,
    serverUpdatedAt: now,
  });
  publish({
    status: "ready",
    revision: 0,
    lastSyncedAt: now,
    message: "Облачные данные удалены",
  });
  return true;
}

export function startAutoSync() {
  if (started) return;
  started = true;
  window.addEventListener("fintrack:datachange", scheduleSync);
  window.addEventListener("online", () => {
    publish({ status: "syncing", message: "Соединение восстановлено…" });
    scheduleSync();
  });
  window.addEventListener("offline", () => {
    publish({ status: "offline", message: "Офлайн — изменения сохранены" });
  });
}
