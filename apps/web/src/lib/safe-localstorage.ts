// utils/storage.ts
export const safeLocalStorage = {
  get(key: string) {
    if (typeof window === 'undefined') return null // SSR guard
    return localStorage.getItem(key)
  },
  set(key: string, value: string) {
    if (typeof window === 'undefined') return // SSR guard
    localStorage.setItem(key, value)
  },
}
