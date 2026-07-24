// apps/web/src/components/global/sidebar-secondary-search.ts
import type { SidebarProps } from '~/constants/menu'

/**
 * Case- and diacritic-insensitive fold used for every haystack and the query.
 *
 * NFD decomposes a precomposed accent into base + combining mark, and stripping the
 * marks returns it to a single character — so the fold is **length-preserving** for
 * the scripts we care about. That is what lets {@link SettingsSearchResult.labelMatch}
 * index straight into the original, unfolded label for highlighting.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** One searchable settings page, with its haystacks folded once at index time. */
export type SettingsSearchEntry = {
  item: SidebarProps
  /** Label of the header group this item sits under, for the result breadcrumb. */
  groupLabel: string
  href: string
  foldedLabel: string
  foldedGroup: string
  foldedKeywords: string[]
  foldedDescription: string
}

export type SettingsSearchResult = SettingsSearchEntry & {
  score: number
  /** `[start, end)` into the original `item.label`, or null when the hit was elsewhere. */
  labelMatch: [number, number] | null
}

/**
 * Match tiers, best first. Deliberately ranked substring matching rather than fuzzy
 * scoring — across ~22 items a fuzzy matcher mostly produces noise ("gen" matching
 * "Mana**g**e **G**roups") while substring ranking stays explainable.
 */
const SCORE = {
  labelPrefix: 0,
  labelWordPrefix: 1,
  labelSubstring: 2,
  keyword: 3,
  group: 4,
  description: 5,
} as const

/** Characters that make the next character a "word start" for tier-1 ranking. */
const WORD_BOUNDARY = /[\s&/_-]/

/**
 * Flattens filtered menu groups into a search index.
 *
 * `groups` must already have come through `useSettingsMenu()` — indexing raw
 * `SETTINGS_MENU` would surface pages the member cannot open.
 */
export function buildSettingsIndex(groups: SidebarProps[], baseUrl: string): SettingsSearchEntry[] {
  return groups.flatMap((group) =>
    (group.items ?? []).map((item) => ({
      item,
      groupLabel: group.label,
      href: `${baseUrl}/${item.slug}`,
      foldedLabel: fold(item.label),
      foldedGroup: fold(group.label),
      foldedKeywords: (item.keywords ?? []).map(fold),
      foldedDescription: fold(item.description ?? ''),
    }))
  )
}

/** Ranks `entries` against `rawQuery`. Returns `[]` for a blank query. */
export function searchSettings(
  entries: SettingsSearchEntry[],
  rawQuery: string
): SettingsSearchResult[] {
  const query = fold(rawQuery.trim())
  if (!query) return []

  const results: SettingsSearchResult[] = []

  for (const entry of entries) {
    const at = entry.foldedLabel.indexOf(query)

    if (at === 0) {
      results.push({ ...entry, score: SCORE.labelPrefix, labelMatch: [0, query.length] })
      continue
    }
    if (at > 0) {
      const isWordStart = WORD_BOUNDARY.test(entry.foldedLabel[at - 1] ?? '')
      results.push({
        ...entry,
        score: isWordStart ? SCORE.labelWordPrefix : SCORE.labelSubstring,
        labelMatch: [at, at + query.length],
      })
      continue
    }
    if (entry.foldedKeywords.some((keyword) => keyword.includes(query))) {
      results.push({ ...entry, score: SCORE.keyword, labelMatch: null })
      continue
    }
    if (entry.foldedGroup.includes(query)) {
      results.push({ ...entry, score: SCORE.group, labelMatch: null })
      continue
    }
    if (entry.foldedDescription.includes(query)) {
      results.push({ ...entry, score: SCORE.description, labelMatch: null })
    }
  }

  // Array.prototype.sort is stable, so equal scores keep menu order.
  return results.sort((a, b) => a.score - b.score)
}
