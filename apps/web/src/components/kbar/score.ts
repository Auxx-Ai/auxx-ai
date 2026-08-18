// apps/web/src/components/kbar/score.ts
'use client'

import { defaultFilter } from 'cmdk'
import type { PaletteAction } from './types'

/**
 * Below this, a fuzzy match is noise rather than a result — `dark` scored
 * `Ticket dashboard` at 0.026 and `Search records` at 0.005 under cmdk's raw
 * scorer, and both rendered *above* `Set Dark Theme`. Returning 0 is how the
 * floor is enforced: cmdk hides zero-scored items and `CommandEmpty` still
 * counts correctly, so no extra render logic is needed.
 */
const FLOOR = 0.1

/** Fuzzy matches are compressed below the deterministic prefix tiers. */
const FUZZY_SCALE = 0.75

/**
 * Rows that must survive the floor: with an arbitrary query (`acme corp`) the
 * palette should still offer a way through to record/thread search instead of
 * "No results found". The value is low enough that they sink below any real
 * match.
 */
const ALWAYS_VISIBLE_IDS = new Set(['search-records', 'search-threads'])
const ALWAYS_VISIBLE_MIN = 0.08

/** Matches the `recent:` value prefix the root page uses to keep cmdk values unique. */
const RECENT_PREFIX = 'recent:'

const WORD_SPLIT = /[\s\-_/.]+/

function words(text: string): string[] {
  return text.toLowerCase().split(WORD_SPLIT).filter(Boolean)
}

/**
 * Score one action against the query.
 *
 * Deliberately scores `label` / `keywords` / `subtitle` **separately** rather
 * than as one flattened blob (which is what cmdk's default filter does with the
 * `keywords` prop), for two reasons:
 *
 * 1. The action id stays out of the scored text. `value` is the id, so under the
 *    default filter `nav.tickets.dashboard` injects a phantom `dashboard` token —
 *    that is literally where the `dark` → "Ticket dashboard" match came from.
 * 2. A subtitle hit no longer counts as much as a label hit.
 *
 * The blob is still scored at `×0.4` so cross-field matches keep working, just
 * ranked below any clean single-field hit.
 */
export function scorePaletteAction(action: PaletteAction, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1

  const label = action.label.toLowerCase()
  if (label === q) return 1
  if (label.startsWith(q)) return 0.95
  if (words(action.label).some((word) => word.startsWith(q))) return 0.9

  const keywords = action.keywords ? words(action.keywords) : []
  if (keywords.includes(q)) return 0.88
  if (keywords.some((word) => word.startsWith(q))) return 0.86

  if (action.subtitle && words(action.subtitle).some((word) => word.startsWith(q))) return 0.8

  const blob = [action.label, action.subtitle, action.keywords].filter(Boolean).join(' ')
  const fuzzy = Math.max(
    defaultFilter(action.label, q),
    action.keywords ? defaultFilter(action.keywords, q) * 0.7 : 0,
    action.subtitle ? defaultFilter(action.subtitle, q) * 0.5 : 0,
    defaultFilter(blob, q) * 0.4
  )

  const scaled = fuzzy * FUZZY_SCALE
  if (scaled >= FLOOR) return scaled
  return ALWAYS_VISIBLE_IDS.has(action.id) ? ALWAYS_VISIBLE_MIN : 0
}

/** One scoreable row: the action plus an optional final-score multiplier. */
export interface PaletteScoreEntry {
  action: PaletteAction
  /**
   * Multiplier on the final score. Page-scoped (contextual) rows take a small
   * edge so they win ties against the static registry — they lose their
   * `priority` ordering once the list goes flat. cmdk puts no upper bound on
   * filter scores, so values above 1 are fine.
   */
  boost?: number
}

/**
 * Build the cmdk `filter` for a rendered set of rows. Works because
 * `PaletteActionItem` sets `value={action.id}`, so cmdk hands the id straight
 * back and the full action can be looked up and scored field-by-field.
 *
 * Anything not in the set (cmdk also scores group headings) falls back to the
 * default filter, so an unregistered row can never silently vanish.
 */
export function createPaletteFilter(
  entries: PaletteScoreEntry[]
): (value: string, search: string, keywords?: string[]) => number {
  const byId = new Map<string, PaletteScoreEntry>()
  for (const entry of entries) byId.set(entry.action.id, entry)

  return (value, search, keywords) => {
    const id = value.startsWith(RECENT_PREFIX) ? value.slice(RECENT_PREFIX.length) : value
    const entry = byId.get(id)
    if (!entry) return defaultFilter(value, search, keywords)
    return scorePaletteAction(entry.action, search) * (entry.boost ?? 1)
  }
}
