// packages/ui/src/components/kb/layout/kb-sidebar-state.ts

const COLLAPSED_KEY = 'kb-sidebar-collapsed'

export function readCollapsedFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeCollapsedToStorage(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? 'true' : 'false')
  } catch {
    /* swallow */
  }
}

export function openIdsKey(kbId: string): string {
  return `kb-${kbId}-openIds`
}

export function readOpenIds(kbId: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(openIdsKey(kbId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeOpenIds(kbId: string, ids: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(openIdsKey(kbId), JSON.stringify(ids))
  } catch {
    /* swallow */
  }
}
