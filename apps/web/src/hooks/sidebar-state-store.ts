// apps/web/src/hooks/sidebar-state-store.ts

import { createStore } from 'zustand/vanilla'

/** Cookie holding sidebar collapse state; read in `app/(protected)/app/layout.tsx` for SSR. */
export const SIDEBAR_COLLAPSE_COOKIE = 'sidebar_collapse'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
/** Encoded cookie budget; oldest toggles are dropped past it (browsers cap a cookie at 4096). */
const MAX_COOKIE_BYTES = 2048

/** Persisted sidebar UI state. Maps hold only ids the user explicitly toggled, oldest first. */
export interface SidebarPersistedState {
  /** Sidebar group headers (`mail`, `configurations`, `favorites`, `records`). */
  groups: Record<string, boolean>
  /** Collapsible sections and folders (NavMain ids, `mail.*`, `favorites.folder.<id>`, …). */
  sections: Record<string, boolean>
  /** Render hidden sidebar rows. */
  showHidden: boolean
}

export interface SidebarStateStore extends SidebarPersistedState {
  /** `defaultOpen` must match what the reader displayed, so the first toggle flips it. */
  toggleGroup: (id: string, defaultOpen?: boolean) => void
  toggleSection: (id: string, defaultOpen: boolean) => void
  setSectionOpen: (id: string, open: boolean) => void
  setShowHidden: (showHidden: boolean) => void
  /** Replace the persisted state (localStorage migration). */
  hydrate: (state: SidebarPersistedState) => void
}

export const EMPTY_SIDEBAR_STATE: SidebarPersistedState = {
  groups: {},
  sections: {},
  showHidden: false,
}

/** Cookie payload: `g`/`s` map id → 0|1, `h` is showHidden. */
interface CookiePayload {
  g?: Record<string, 0 | 1>
  s?: Record<string, 0 | 1>
  h?: 1
}

function toBits(map: Record<string, boolean>): Record<string, 0 | 1> {
  const out: Record<string, 0 | 1> = {}
  for (const [id, open] of Object.entries(map)) out[id] = open ? 1 : 0
  return out
}

function fromBits(value: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!value || typeof value !== 'object') return out
  for (const [id, bit] of Object.entries(value)) {
    if (bit === 0 || bit === 1 || typeof bit === 'boolean') out[id] = Boolean(bit)
  }
  return out
}

function encode(state: SidebarPersistedState): string {
  const payload: CookiePayload = {}
  if (Object.keys(state.groups).length) payload.g = toBits(state.groups)
  if (Object.keys(state.sections).length) payload.s = toBits(state.sections)
  if (state.showHidden) payload.h = 1
  return encodeURIComponent(JSON.stringify(payload))
}

/** Drop the oldest section toggles (then group toggles) until the encoded value fits the budget. */
export function pruneSidebarState(
  state: SidebarPersistedState,
  maxBytes = MAX_COOKIE_BYTES
): SidebarPersistedState {
  if (encode(state).length <= maxBytes) return state
  const sections = { ...state.sections }
  const groups = { ...state.groups }
  const next = { ...state, sections, groups }
  for (const id of Object.keys(sections)) {
    delete sections[id]
    if (encode(next).length <= maxBytes) return next
  }
  for (const id of Object.keys(groups)) {
    delete groups[id]
    if (encode(next).length <= maxBytes) return next
  }
  return next
}

/** Encoded cookie value, pruned to the size budget. */
export function serializeSidebarState(state: SidebarPersistedState): string {
  return encode(pruneSidebarState(state))
}

/** Parse a cookie value (raw or already URI-decoded); anything malformed yields empty state. */
export function parseSidebarState(raw: string | undefined | null): SidebarPersistedState {
  if (!raw) return EMPTY_SIDEBAR_STATE
  try {
    const text = raw.startsWith('{') ? raw : decodeURIComponent(raw)
    const payload = JSON.parse(text) as CookiePayload | null
    if (!payload || typeof payload !== 'object') return EMPTY_SIDEBAR_STATE
    return {
      groups: fromBits(payload.g),
      sections: fromBits(payload.s),
      showHidden: payload.h === 1,
    }
  } catch {
    return EMPTY_SIDEBAR_STATE
  }
}

function writeCookie(state: SidebarPersistedState) {
  if (typeof document === 'undefined') return
  document.cookie = `${SIDEBAR_COLLAPSE_COOKIE}=${serializeSidebarState(state)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
}

/** Re-inserting moves the id to the end, so key order is toggle recency for pruning. */
function withEntry(map: Record<string, boolean>, id: string, open: boolean) {
  const { [id]: _, ...rest } = map
  return { ...rest, [id]: open }
}

/** One store per app shell, seeded synchronously from the SSR cookie. */
export function createSidebarStateStore(initial: SidebarPersistedState = EMPTY_SIDEBAR_STATE) {
  return createStore<SidebarStateStore>()((set, get) => {
    const persist = (patch: Partial<SidebarPersistedState>) => {
      set(patch)
      const { groups, sections, showHidden } = get()
      writeCookie({ groups, sections, showHidden })
    }
    return {
      ...initial,
      toggleGroup: (id, defaultOpen = true) =>
        persist({ groups: withEntry(get().groups, id, !(get().groups[id] ?? defaultOpen)) }),
      toggleSection: (id, defaultOpen) =>
        persist({
          sections: withEntry(get().sections, id, !(get().sections[id] ?? defaultOpen)),
        }),
      setSectionOpen: (id, open) => persist({ sections: withEntry(get().sections, id, open) }),
      setShowHidden: (showHidden) => persist({ showHidden }),
      hydrate: (state) => persist(state),
    }
  })
}

export type SidebarStateStoreApi = ReturnType<typeof createSidebarStateStore>
