import type { Currency, DateToleranceMode, StatementMapping, StatementPresetId } from '@ccm/shared';

// 本机核验草稿不包含原始 CSV 字节、服务器账单或匹配结果。
// 为了支持用户再次调整列映射，保留解码后的表格行；属于敏感数据，IndexedDB 不加密。
export interface ReconcileDraftSource {
  id: string;
  label: string;
  encoding: 'utf-8' | 'shift_jis' | 'text';
  preset: StatementPresetId | null;
  rows: string[][];
  accountId: string;
  currency: Currency;
  mapping: StatementMapping;
}

export interface ReconcileDraft {
  sources: ReconcileDraftSource[];
  tolerance: DateToleranceMode;
  includePaid: boolean;
  manualRange: boolean;
  rangeFrom: string;
  rangeTo: string;
  manualSelections: Record<string, string>;
  checkedIds: string[];
  userUncheckedIds: string[];
}

interface StoredDraft extends ReconcileDraft {
  version: 1;
  updatedAt: number;
}

const DATABASE = 'useecard-reconcile-workspace';
const STORE = 'drafts';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 10 * 1024 * 1024;

let enabled = true;
let generation = 0;
let pending: Promise<void> = Promise.resolve();
const memory = new Map<string, StoredDraft>();

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T;
      action(tx.objectStore(STORE), value => { result = value; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('本机缓存事务中断'));
    });
  } finally {
    db.close();
  }
}

function serialize(task: () => Promise<void>): Promise<void> {
  const result = pending.catch(() => undefined).then(task);
  pending = result.catch(() => undefined);
  return result;
}

function expired(value: StoredDraft): boolean {
  return value.version !== 1 ||
    !Number.isFinite(value.updatedAt) ||
    Date.now() - value.updatedAt > TTL_MS ||
    value.updatedAt > Date.now() + 60_000;
}

export function enableReconcileDrafts(): void {
  enabled = true;
}

export async function loadReconcileDraft(owner: string): Promise<ReconcileDraft | null> {
  if (!enabled || !owner) return null;
  let draft = memory.get(owner);
  if (!draft) {
    await pending;
    if (!enabled) return null;
    draft = await withStore<StoredDraft | undefined>('readonly', (store, done) => {
      const request = store.get(owner);
      request.onsuccess = () => done(request.result as StoredDraft | undefined);
    });
  }
  if (!draft) return null;
  if (expired(draft)) {
    await clearReconcileDraft(owner);
    return null;
  }
  memory.set(owner, draft);
  const { version: _version, updatedAt: _updatedAt, ...data } = draft;
  return structuredClone(data);
}

export function saveReconcileDraft(owner: string, draft: ReconcileDraft): Promise<void> {
  if (!enabled || !owner) return Promise.resolve();
  const stored: StoredDraft = { ...structuredClone(draft), version: 1, updatedAt: Date.now() };
  if (new Blob([JSON.stringify(stored)]).size > MAX_BYTES) {
    return Promise.reject(new Error('核验数据超过 10 MB，无法持久化本机缓存'));
  }
  memory.set(owner, stored);
  const ticket = generation;
  return serialize(async () => {
    if (!enabled || ticket !== generation) return;
    await withStore<void>('readwrite', (store) => { store.put(stored, owner); });
  });
}

export function clearReconcileDraft(owner: string): Promise<void> {
  if (!owner) return Promise.resolve();
  memory.delete(owner);
  generation++;
  return serialize(async () => {
    await withStore<void>('readwrite', store => { store.delete(owner); });
  });
}

// 退出或会话失效时先同步禁止后续写入，再依次清空所有本机核验草稿。
export function clearAllReconcileDrafts(): Promise<void> {
  enabled = false;
  generation++;
  memory.clear();
  return serialize(async () => {
    await withStore<void>('readwrite', store => { store.clear(); });
  });
}
