// apps/web/src/hooks/sidebar-state-store.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createSidebarStateStore,
  EMPTY_SIDEBAR_STATE,
  parseSidebarState,
  pruneSidebarState,
  SIDEBAR_COLLAPSE_COOKIE,
  type SidebarPersistedState,
  serializeSidebarState,
} from './sidebar-state-store'

function readCookie(): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${SIDEBAR_COLLAPSE_COOKIE}=`))
    ?.slice(SIDEBAR_COLLAPSE_COOKIE.length + 1)
}

describe('sidebar state store', () => {
  beforeEach(() => {
    document.cookie = `${SIDEBAR_COLLAPSE_COOKIE}=; path=/; max-age=0`
  })

  it('first toggle of a closed-by-default section opens it', () => {
    const store = createSidebarStateStore()
    store.getState().toggleSection('favorites.folder.a', false)
    expect(store.getState().sections['favorites.folder.a']).toBe(true)
    store.getState().toggleSection('favorites.folder.a', false)
    expect(store.getState().sections['favorites.folder.a']).toBe(false)
  })

  it('first toggle of an open-by-default section or group closes it', () => {
    const store = createSidebarStateStore()
    store.getState().toggleSection('getting-started:main', true)
    store.getState().toggleGroup('mail')
    expect(store.getState().sections['getting-started:main']).toBe(false)
    expect(store.getState().groups.mail).toBe(false)
  })

  it('keeps group and section toggles in one state without clobbering', () => {
    const store = createSidebarStateStore()
    store.getState().toggleSection('mail.views', true)
    store.getState().toggleGroup('records')
    store.getState().setSectionOpen('records.folder.x', true)
    const parsed = parseSidebarState(readCookie())
    expect(parsed.groups).toEqual({ records: false })
    expect(parsed.sections).toEqual({ 'mail.views': false, 'records.folder.x': true })
  })

  it('seeds from initial state and persists showHidden', () => {
    const store = createSidebarStateStore({
      groups: { mail: false },
      sections: {},
      showHidden: false,
    })
    expect(store.getState().groups.mail).toBe(false)
    store.getState().setShowHidden(true)
    expect(parseSidebarState(readCookie()).showHidden).toBe(true)
  })
})

describe('cookie serialize/parse', () => {
  it('round-trips encoded and decoded values', () => {
    const state: SidebarPersistedState = {
      groups: { mail: false, records: true },
      sections: { 'favorites.folder.abc': true },
      showHidden: true,
    }
    const encoded = serializeSidebarState(state)
    expect(parseSidebarState(encoded)).toEqual(state)
    expect(parseSidebarState(decodeURIComponent(encoded))).toEqual(state)
  })

  it('returns empty state for missing or malformed input', () => {
    expect(parseSidebarState(undefined)).toEqual(EMPTY_SIDEBAR_STATE)
    expect(parseSidebarState('%7Bnope')).toEqual(EMPTY_SIDEBAR_STATE)
    expect(parseSidebarState('null')).toEqual(EMPTY_SIDEBAR_STATE)
    expect(parseSidebarState('{"s":{"a":"yes","b":1}}').sections).toEqual({ b: true })
  })

  it('prunes the oldest section toggles to fit the budget', () => {
    const sections: Record<string, boolean> = {}
    for (let i = 0; i < 200; i++)
      sections[`favorites.folder.cm${String(i).padStart(22, '0')}`] = true
    const state = { groups: { mail: false }, sections, showHidden: false }
    const pruned = pruneSidebarState(state)
    const ids = Object.keys(pruned.sections)
    expect(serializeSidebarState(state).length).toBeLessThanOrEqual(2048)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.at(-1)).toBe(Object.keys(sections).at(-1))
    expect(ids).not.toContain(Object.keys(sections)[0])
    expect(pruned.groups).toEqual({ mail: false })
  })

  it('moves a re-toggled id to the newest position', () => {
    const store = createSidebarStateStore()
    store.getState().setSectionOpen('a', true)
    store.getState().setSectionOpen('b', true)
    store.getState().setSectionOpen('a', false)
    expect(Object.keys(store.getState().sections)).toEqual(['b', 'a'])
  })
})
