/**
 * jsdom setup for browser-half specs: stub localStorage (the shell's storage
 * lives in the object layer; a plain stub is enough for store persistence),
 * and silence React act warnings noise.
 */
if (typeof window !== 'undefined') {
  const storage = (() => {
    const map = new Map<string, string>()
    return {
      getItem: (key: string): string | null => map.get(key) ?? null,
      setItem: (key: string, value: string): void => { map.set(key, value) },
      removeItem: (key: string): void => { map.delete(key) },
      clear: (): void => { map.clear() },
    }
  })()
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}
