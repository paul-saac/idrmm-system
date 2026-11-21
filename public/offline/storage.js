// Shared by the browser-only workspace and the signed-in Next.js application.
// Store data, never passwords/access tokens or authenticated HTML responses.
const DATABASE = "idrmm-offline-v1";
let opened;
const listeners = new Set();
let channel;
function changed() {
  listeners.forEach(fn => fn());
  if (typeof window !== "undefined") window.dispatchEvent(new Event("idrmm-offline-change"));
  channel?.postMessage("changed");
}
export function subscribeOffline(fn) {
  listeners.add(fn);
  if (typeof BroadcastChannel !== "undefined" && !channel) {
    channel = new BroadcastChannel("idrmm-offline");
    channel.onmessage = () => listeners.forEach(listener => listener());
  }
  return () => listeners.delete(fn);
}
function database() {
  if (!opened) opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const name of ["projects", "outbox", "drafts", "settings"]) request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = null; }; resolve(request.result); };
    request.onerror = () => { opened = null; reject(request.error); };
    request.onblocked = () => { opened = null; reject(new Error("Close other IDRMM tabs and try again.")); };
  });
  return opened;
}
async function transaction(stores, write, run) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, write ? "readwrite" : "readonly");
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || new Error("Could not save on this device."));
    tx.onabort = () => reject(tx.error || new Error("Could not save on this device."));
    run(tx, result => { value = result; });
  });
}
export const localGet = (store, id) => transaction([store], false, (tx, done) => { const request = tx.objectStore(store).get(id); request.onsuccess = () => done(request.result); });
export const localAll = store => transaction([store], false, (tx, done) => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => done(request.result); });
export async function localPut(store, value) { await transaction([store], true, tx => tx.objectStore(store).put(value)); changed(); }
export async function localDelete(store, id) { await transaction([store], true, tx => tx.objectStore(store).delete(id)); changed(); }
export const projectKey = (owner, project) => `${owner}:${project}`;
export const draftKey = (owner, project, item, date) => `${owner}:${project}:${item}:${date}`;
export const manilaDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
export const activeOfflineOwner = () => localGet("settings", "owner");
export async function activateOfflineOwner(id) {
  const current = await activeOfflineOwner();
  if (current?.ownerId !== id || current?.locked) await localPut("settings", { id: "owner", ownerId: id, locked: false });
}
export async function lockOfflineWorkspace() {
  const current = await activeOfflineOwner();
  if (current) await localPut("settings", { ...current, locked: true });
}
export async function registerOfflineWorker() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) throw new Error("Offline logging requires HTTPS and a supported browser.");
  await navigator.serviceWorker.register("/offline-sw.js", { scope: "/", updateViaCache: "none" });
  const registration = await navigator.serviceWorker.ready;
  if (!registration.active) throw new Error("The offline workspace is not ready. Retry in a moment.");
  // A handshake verifies the full shell cache before announcing readiness.
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => reject(new Error("Could not prepare the offline screen. Retry.")), 15000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); if (event.data?.ready) resolve(); else reject(new Error("The offline screen is incomplete. Retry while online.")); };
    registration.active.postMessage({ type: "OFFLINE_READY" }, [channel.port2]);
  });
}
export async function prepareOfflineProject(projectId, workDate) {
  await registerOfflineWorker();
  const response = await fetch(`/api/offline/projects/${projectId}${workDate ? `?workDate=${encodeURIComponent(workDate)}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000) });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "Could not prepare this project. Sign in and retry."); }
  const project = await response.json();
  const previous = await localGet("projects", projectKey(project.ownerId, project.id));
  const dated = Object.fromEntries(Object.entries(project.states).map(([key, value]) => [`${key}:${project.workDate}`, value]));
  await localPut("projects", { ...project, id: projectKey(project.ownerId, project.id), projectId: project.id,
    availableFrom: [previous?.availableFrom ?? project.workDate, project.workDate].sort()[0],
    states: { ...previous?.states, ...project.states, ...dated },
    totals: Object.fromEntries(Object.entries(project.states).map(([key, value]) => [key, value.totalQuantity])) });
  await activateOfflineOwner(project.ownerId);
  // Best effort; browsers can refuse persistent storage, so show save failures.
  try { await navigator.storage?.persist?.(); } catch { /* No persistence guarantee. */ }
  return project;
}

export async function queueOfflineLog(project, item, workDate, input, expectedVersion, replacesId) {
  const owner = await activeOfflineOwner();
  if (owner?.locked || owner?.ownerId !== project.ownerId) throw new Error("Sign in with the original account before preparing offline work.");
  if (workDate < (project.availableFrom ?? project.workDate) || workDate > manilaDate()) throw new Error("Choose a work date between the download date and today.");
  const queued = { id: crypto.randomUUID(), ownerId: project.ownerId, projectId: project.projectId ?? project.id,
    kind: item.kind, itemId: item.id, workDate, capturedAt: new Date().toISOString(), expectedVersion, input: structuredClone(input), status: "pending", attempted: false };
  let duplicate = false;
  await transaction(["outbox", "drafts"], true, tx => {
    const request = tx.objectStore("outbox").getAll();
    request.onsuccess = () => {
      duplicate = request.result.some(row => row.ownerId === queued.ownerId && row.projectId === queued.projectId && row.kind === queued.kind && row.itemId === queued.itemId && row.workDate === queued.workDate && row.status !== "synced" && !(row.id === replacesId && row.status === "needs-review"));
      if (duplicate) return;
      if (replacesId) {
        const old = request.result.find(row => row.id === replacesId && row.status === "needs-review" && row.ownerId === queued.ownerId && row.projectId === queued.projectId && row.kind === queued.kind && row.itemId === queued.itemId && row.workDate === queued.workDate);
        if (!old) { duplicate = true; return; }
        tx.objectStore("outbox").delete(replacesId);
      }
      tx.objectStore("outbox").add(queued);
      tx.objectStore("drafts").delete(draftKey(queued.ownerId, queued.projectId, `${item.kind}-${item.id}`, workDate));
    };
  });
  if (duplicate) throw new Error("A saved entry for this task and date is already awaiting synchronization. Review it in Saved entries.");
  changed();
  return queued;
}

async function claim(id) {
  return transaction(["outbox"], true, (tx, done) => {
    const store = tx.objectStore("outbox"), request = store.get(id);
    request.onsuccess = () => {
      const row = request.result;
      if (!row || ["synced", "needs-review"].includes(row.status) || row.leaseUntil > Date.now()) return done(null);
      const next = { ...row, status: "syncing", attempted: true, leaseUntil: Date.now() + 60000 };
      store.put(next); done(next);
    };
  });
}
let running = false, retryAfter = 0, failures = 0;
export async function synchronizeOfflineLogs(force = false) {
  if (running || navigator.onLine === false || !force && Date.now() < retryAfter) return;
  running = true;
  try {
    const owner = await activeOfflineOwner();
    if (!owner || owner.locked) return;
    const pending = (await localAll("outbox")).filter(row => row.ownerId === owner.ownerId && ["pending", "syncing", "auth-required"].includes(row.status)).sort((a, b) => a.workDate.localeCompare(b.workDate) || a.capturedAt.localeCompare(b.capturedAt));
    if (!pending.length) return;
    const session = await fetch("/api/offline/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (session.status === 401) {
      for (const row of pending) if (row.status !== "auth-required") await localPut("outbox", { ...row, status: "auth-required", leaseUntil: 0, error: "Sign in again with the original account to synchronize." });
      return;
    }
    if (!session.ok) throw new Error("Connection unavailable.");
    const account = await session.json();
    if (account.id !== owner.ownerId) { await lockOfflineWorkspace(); return; }
    for (const candidate of pending) {
      const row = await claim(candidate.id); if (!row) continue;
      changed();
      let response, result;
      try {
        response = await fetch("/api/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
          body: JSON.stringify(row), signal: AbortSignal.timeout(25000) });
        result = await response.json();
      } catch {
        await localPut("outbox", { ...row, status: "pending", leaseUntil: 0, error: "Connection interrupted. Your entry is saved and will retry safely." });
        throw new Error("Connection unavailable.");
      }
      if (response.ok) {
        // Only an explicit server receipt can turn a pending entry into Synced.
        if (result.id !== row.id || !result.state) {
          await localPut("outbox", { ...row, status: "pending", leaseUntil: 0, error: "Could not confirm synchronization. Your saved entry will retry safely." });
          throw new Error("Invalid synchronization receipt.");
        }
        await transaction(["outbox", "projects"], true, tx => {
          tx.objectStore("outbox").put({ ...row, status: "synced", leaseUntil: 0, error: undefined, synchronizedAt: new Date().toISOString() });
          const store = tx.objectStore("projects"), request = store.get(projectKey(row.ownerId, row.projectId));
          request.onsuccess = () => { if (request.result) store.put({ ...request.result,
            states: { ...request.result.states, [`${row.kind}-${row.itemId}:${row.workDate}`]: result.state },
            totals: { ...request.result.totals, [`${row.kind}-${row.itemId}`]: result.state.totalQuantity } }); };
        });
        changed();
        window.dispatchEvent(new CustomEvent("idrmm-offline-synced", { detail: { projectId: row.projectId } }));
      } else if ([400, 403, 409, 413, 422].includes(response.status)) {
        await localPut("outbox", { ...row, status: "needs-review", leaseUntil: 0, error: result.error || "Review this entry before retrying." });
      } else {
        await localPut("outbox", { ...row, status: response.status === 401 ? "auth-required" : "pending", leaseUntil: 0, error: result.error || "Synchronization is temporarily unavailable." });
        if (response.status === 401) return;
        throw new Error("Server unavailable.");
      }
    }
    failures = 0; retryAfter = 0;
  } catch {
    retryAfter = Date.now() + Math.min(120000, 5000 * 2 ** Math.min(failures++, 5));
  } finally { running = false; }
}

export async function offlineEntryState(project, item, date) {
  const exact = project.states[`${item.key}:${date}`];
  if (exact) return { ...exact, totalQuantity: project.totals?.[item.key] ?? exact.totalQuantity };
  if (date === project.workDate && project.states[item.key]) return { ...project.states[item.key], totalQuantity: project.totals?.[item.key] ?? project.states[item.key].totalQuantity };
  return { version: null, totalQuantity: project.totals?.[item.key] ?? project.states[item.key]?.totalQuantity ?? 0, input: null };
}
