// Test-environment polyfills for browser globals the plugin touches at load
// time (Plugin.onload reads window.localStorage and crypto.randomUUID).
const storage = new Map<string, string>();

const localStorageStub = {
  getItem: (key: string): string | null => storage.get(key) ?? null,
  setItem: (key: string, value: string): void => { storage.set(key, value); },
  removeItem: (key: string): void => { storage.delete(key); },
  clear: (): void => { storage.clear(); },
  key: (index: number): string | null => [...storage.keys()][index] ?? null,
  get length(): number { return storage.size; },
};

Object.defineProperty(globalThis, 'window', {
  value: {
    localStorage: localStorageStub,
    clearTimeout,
    setInterval,
    setTimeout,
  },
  writable: true,
  configurable: true,
});

if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID !== 'function') {
  const { randomUUID } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    writable: true,
    configurable: true,
  });
}
