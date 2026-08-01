// apps/web/src/components/kbar/shortcuts.ts

import type { Hotkey } from '@tanstack/react-hotkeys'

/**
 * The ONE place command-palette chords live. Maps a `PaletteAction.id` to its
 * key sequence, in the uppercase casing `@tanstack/hotkeys` registers (matching
 * is case-insensitive; `ShortcutHint` lowercases for display).
 * `use-palette-hotkeys` binds every entry here through a single
 * `useHotkeySequence` loop, so a chord is registered exactly once.
 *
 * Deliberately NOT here:
 * - Create chords (`c,c` / `c,o` / `c,t` / `c,p`) — owned by global-create
 *   (`SYSTEM_CREATE_HOTKEYS`); the palette only *displays* them.
 * - Task create (`T,N`) — owned by `FloatingTaskRoot`.
 *
 * Sequence-manager note: a chord fires the instant it fully matches, and a
 * shorter chord fires *en route* to a longer one that extends it. So no chord
 * may be a prefix of another (e.g. `g,i` + `g,i,d` would double-fire). The
 * dev-only assertion below enforces this. Folder children whose parent already
 * owns a 2-key chord (Inbox `g,i`, Shopify `g,h`) intentionally get no chord —
 * they remain reachable via search.
 */
export const SHORTCUTS: Record<string, Hotkey[]> = {
  // ── Navigation (top-level) ──────────────────────────────────────────────
  'nav.inbox': ['G', 'I'],
  'nav.contacts': ['G', 'C'],
  'nav.companies': ['G', 'O'],
  'nav.parts': ['G', 'P'],
  'nav.tickets': ['G', 'T'],
  'nav.tasks': ['G', 'A'],
  'nav.workflows': ['G', 'W'],
  'nav.kb': ['G', 'K'],
  'nav.datasets': ['G', 'D'],
  'nav.files': ['G', 'F'],

  // ── Shared Inbox (3-key siblings; no `g,s` parent chord, so all reachable) ─
  'nav.sharedInbox.unassigned': ['G', 'S', 'U'],
  'nav.sharedInbox.assigned': ['G', 'S', 'A'],
  'nav.sharedInbox.done': ['G', 'S', 'D'],
  'nav.sharedInbox.trash': ['G', 'S', 'T'],
  'nav.sharedInbox.spam': ['G', 'S', 'P'],

  // ── Settings (member-visible) ───────────────────────────────────────────
  'settings.general': ['S', 'G'],
  'settings.account': ['S', 'U'],
  'settings.organization': ['S', 'O'],
  'settings.snippets': ['S', 'N'],
  'settings.signatures': ['S', 'S'],
  'settings.apiKeys': ['S', 'K'],

  // ── Settings (admin) ────────────────────────────────────────────────────
  'settings.channels': ['S', 'I'],
  'settings.members': ['S', 'M'],
  'settings.groups': ['S', 'R'],
  'settings.inbox': ['S', 'B'],
  'settings.aiModels': ['S', 'A'],
  'settings.customFields': ['S', 'C'],
  'settings.tags': ['S', 'T'],
  'settings.apps': ['S', 'P'],
  'settings.webhooks': ['S', 'W'],

  // ── Create (palette-owned launchers; entity creates live in global-create) ─
  'create.dashboard': ['C', 'D'],

  // ── Theme ───────────────────────────────────────────────────────────────
  'theme.toggle': ['T', 'T'],
  'theme.light': ['T', 'L'],
  'theme.dark': ['T', 'D'],
}

/**
 * Dev-only guard: throws if any two chords are identical or if one is a prefix
 * of another (both cause double/shadow firing with the sequence manager).
 * Runs once at module load in non-production builds.
 */
function assertNoChordConflicts(map: Record<string, Hotkey[]>): void {
  const entries = Object.entries(map)
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, a] = entries[i]!
      const [idB, b] = entries[j]!
      const min = Math.min(a.length, b.length)
      let shared = true
      for (let k = 0; k < min; k++) {
        if (a[k] !== b[k]) {
          shared = false
          break
        }
      }
      // `shared` over the common length means one is a prefix of the other
      // (or they're identical when lengths match).
      if (shared) {
        throw new Error(
          `[command-palette] chord conflict: "${idA}" (${a.join(' ')}) and "${idB}" (${b.join(
            ' '
          )}) — one is a prefix of the other and they would double-fire.`
        )
      }
    }
  }
}

if (process.env.NODE_ENV !== 'production') {
  assertNoChordConflicts(SHORTCUTS)
}
