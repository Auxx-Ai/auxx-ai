// apps/web/src/components/kbar/shortcuts.ts

/**
 * The ONE place command-palette chords live. Maps a `PaletteAction.id` to its
 * key sequence (lowercase, exactly as displayed). `use-palette-hotkeys` binds
 * every entry here through a single `useHotkeySequence` loop, so a chord is
 * registered exactly once.
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
export const SHORTCUTS: Record<string, string[]> = {
  // ── Navigation (top-level) ──────────────────────────────────────────────
  'nav.inbox': ['g', 'i'],
  'nav.contacts': ['g', 'c'],
  'nav.companies': ['g', 'o'],
  'nav.parts': ['g', 'p'],
  'nav.tickets': ['g', 't'],
  'nav.tasks': ['g', 'a'],
  'nav.workflows': ['g', 'w'],
  'nav.kb': ['g', 'k'],
  'nav.datasets': ['g', 'd'],
  'nav.files': ['g', 'f'],
  // Shopify moved off `g,s` (it used to shadow every `g,s,*` shared-inbox chord).
  'nav.shopify': ['g', 'h'],

  // ── Shared Inbox (3-key siblings; no `g,s` parent chord, so all reachable) ─
  'nav.sharedInbox.unassigned': ['g', 's', 'u'],
  'nav.sharedInbox.assigned': ['g', 's', 'a'],
  'nav.sharedInbox.done': ['g', 's', 'd'],
  'nav.sharedInbox.trash': ['g', 's', 't'],
  'nav.sharedInbox.spam': ['g', 's', 'p'],

  // ── Settings (member-visible) ───────────────────────────────────────────
  'settings.general': ['s', 'g'],
  'settings.account': ['s', 'u'],
  'settings.organization': ['s', 'o'],
  'settings.snippets': ['s', 'n'],
  'settings.signatures': ['s', 's'],
  'settings.apiKeys': ['s', 'k'],

  // ── Settings (admin) ────────────────────────────────────────────────────
  'settings.channels': ['s', 'i'],
  'settings.members': ['s', 'm'],
  'settings.groups': ['s', 'r'],
  'settings.inbox': ['s', 'b'],
  'settings.aiModels': ['s', 'a'],
  'settings.customFields': ['s', 'c'],
  'settings.tags': ['s', 't'],
  'settings.apps': ['s', 'p'],
  'settings.webhooks': ['s', 'w'],
  'settings.shopify': ['s', 'h'],

  // ── Theme ───────────────────────────────────────────────────────────────
  'theme.toggle': ['t', 't'],
  'theme.light': ['t', 'l'],
  'theme.dark': ['t', 'd'],
}

/**
 * Dev-only guard: throws if any two chords are identical or if one is a prefix
 * of another (both cause double/shadow firing with the sequence manager).
 * Runs once at module load in non-production builds.
 */
function assertNoChordConflicts(map: Record<string, string[]>): void {
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
