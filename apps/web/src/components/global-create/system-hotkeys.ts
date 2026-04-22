// apps/web/src/components/global-create/system-hotkeys.ts

/**
 * Fixed palette-sequence shortcuts for system entities. Source of truth for:
 * - actual hotkey bindings (GlobalCreateRoot's useHotkeySequence calls)
 * - palette "Create X" action display hints (useEntityCreateActions)
 * - inline Kbd hints on "New X" buttons
 *
 * Custom entities intentionally get no auto-assigned hotkey — too conflict-prone.
 * Keyed by `resource.apiSlug`.
 */
export const SYSTEM_CREATE_HOTKEYS: Record<string, [string, string]> = {
  contacts: ['c', 'c'],
  companies: ['c', 'o'],
  tickets: ['c', 't'],
  parts: ['c', 'p'],
}

/** Lookup the create hotkey for a resource by its apiSlug (case-insensitive). */
export function getCreateHotkey(apiSlug: string | undefined | null): [string, string] | undefined {
  if (!apiSlug) return undefined
  return SYSTEM_CREATE_HOTKEYS[apiSlug.toLowerCase()]
}
