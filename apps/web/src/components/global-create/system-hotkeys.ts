// apps/web/src/components/global-create/system-hotkeys.ts

import type { Hotkey } from '@tanstack/react-hotkeys'

/** A two-step create chord, in the casing `@tanstack/hotkeys` registers. */
export type CreateChord = [Hotkey, Hotkey]

/**
 * Fixed palette-sequence shortcuts for system entities. Source of truth for:
 * - actual hotkey bindings (GlobalCreateRoot's useHotkeySequence calls)
 * - palette "Create X" action display hints (useEntityCreateActions)
 * - inline Kbd hints on "New X" buttons
 *
 * Letter keys are uppercase because that is the only casing `Hotkey` accepts —
 * matching itself is case-insensitive.
 *
 * Custom entities intentionally get no auto-assigned hotkey — too conflict-prone.
 * Keyed by `resource.apiSlug`.
 */
export const SYSTEM_CREATE_HOTKEYS = {
  contacts: ['C', 'C'],
  companies: ['C', 'O'],
  tickets: ['C', 'T'],
  parts: ['C', 'P'],
} satisfies Record<string, CreateChord>

/** Lookup the create hotkey for a resource by its apiSlug (case-insensitive). */
export function getCreateHotkey(apiSlug: string | undefined | null): CreateChord | undefined {
  if (!apiSlug) return undefined
  const slug = apiSlug.toLowerCase()
  return slug in SYSTEM_CREATE_HOTKEYS
    ? SYSTEM_CREATE_HOTKEYS[slug as keyof typeof SYSTEM_CREATE_HOTKEYS]
    : undefined
}
