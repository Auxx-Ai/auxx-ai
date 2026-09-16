// apps/web/src/components/accounting/ui/settings/posting-page-model.ts

// What the Posting settings page and the posting guide share
// (plans/accounting/tasks/28-how-your-books-post.md §3, §4).
//
// Both screens render `POSTING_POLICY` and nothing else says what a posting
// type does. What lives HERE is the chrome around the policy: the order the
// trigger kinds appear in, the icon per kind, where a setting that another page
// owns is edited, and the humanised fallback title for a setting key the policy
// gives no copy. The row copy per setting and the records (gateways, bank
// accounts) a type reads are `settingCopy` and `records` ON the policy (brief
// 28 §10 decision 7), so nothing here is prose about a posting type and the
// page and the guide cannot drift from each other.
//
// A key listed on a policy but owned by another page (the opening inventory
// balances live on Opening balances; the cutoff and book timezone on General)
// is LINKED from here, never rendered as a second input. Decision 1 of brief 28
// §10 is that two homes for one setting is how a mode ends up disagreeing with
// the sentence beside it.

import {
  POSTING_POLICIES,
  POSTING_POLICY,
  type PostingPolicy,
  type PostingTrigger,
  type PostingType,
} from '@auxx/lib/postings/client'
import {
  ArrowDownToLine,
  Ban,
  CalendarClock,
  type LucideIcon,
  MousePointerClick,
  Zap,
} from 'lucide-react'

export const POSTING_SETTINGS_HREF = '/app/accounting/settings/posting'

/** The `id` of a type's section on the Posting page, for the guide to link into. */
export function postingSectionAnchor(type: PostingType): string {
  return `posting-${type}`
}

/** The page order: what posts on its own first, then what a person or a sync drives. */
export const TRIGGER_KIND_ORDER: readonly PostingTrigger['kind'][] = [
  'event',
  'schedule',
  'console',
  'inbound',
  'never',
]

export const TRIGGER_KIND_LABEL: Record<PostingTrigger['kind'], string> = {
  event: 'On an event',
  schedule: 'On a schedule',
  console: 'From the console',
  inbound: 'From the connected system',
  never: 'Never',
}

export const TRIGGER_KIND_ICON: Record<PostingTrigger['kind'], LucideIcon> = {
  event: Zap,
  schedule: CalendarClock,
  console: MousePointerClick,
  inbound: ArrowDownToLine,
  never: Ban,
}

/** The trigger as one sentence, off whichever field the kind carries. Null for `never`. */
export function triggerSentence(trigger: PostingTrigger): string | null {
  switch (trigger.kind) {
    case 'event':
      return trigger.on
    case 'schedule':
      return trigger.description
    case 'console':
      return trigger.where
    case 'inbound':
      return trigger.from
    case 'never':
      return null
  }
}

/**
 * Every policy that writes to the ledger by some door, in trigger-kind order and
 * declaration order within a kind. `provider_sync` is here although `enabled`
 * is false on it: the Sync button writes that type, and this page is where a
 * person learns that.
 */
export const POSTING_PAGE_POLICIES: readonly PostingPolicy[] = TRIGGER_KIND_ORDER.filter(
  (kind) => kind !== 'never'
).flatMap((kind) => POSTING_POLICIES.filter((policy) => policy.trigger.kind === kind))

/** The declared `never` types, for the collapsed "Not posting" section. */
export const NEVER_POLICIES: readonly PostingPolicy[] = POSTING_POLICIES.filter(
  (policy) => policy.trigger.kind === 'never'
)

/** Where a policy-listed setting is edited when it is NOT this page. */
export const EXTERNAL_SETTING_HOMES: Readonly<Record<string, { label: string; href: string }>> = {
  'accounting.cutoffPeriod': { label: 'General', href: '/app/accounting/settings/general' },
  'accounting.bookTimeZone': { label: 'General', href: '/app/accounting/settings/general' },
  'ledger.lockedThroughMonth': { label: 'the ledger', href: '/app/accounting' },
  'accounting.openingRawMaterials': {
    label: 'Opening balances',
    href: '/app/accounting/settings/opening',
  },
  'accounting.openingWip': { label: 'Opening balances', href: '/app/accounting/settings/opening' },
  'accounting.openingFinishedGoods': {
    label: 'Opening balances',
    href: '/app/accounting/settings/opening',
  },
}

/**
 * The title a setting key shows on this page and in the guide: the policy's
 * `settingCopy` title when it declares one, else the key's last segment
 * humanised (`bookTimeZone` reads `Book time zone`). The ledger-wide keys and
 * the keys another page owns have no policy copy and take the fallback.
 */
export function settingRowTitle(key: string, policy?: PostingPolicy): string {
  const copy = policy?.settingCopy?.[key]
  if (copy) return copy.title
  const last = key.split('.').at(-1) ?? key
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** The setting keys this page renders as INPUTS: everything on a policy that no other page owns. */
export const POSTING_PAGE_INPUT_KEYS: readonly string[] = POSTING_PAGE_POLICIES.flatMap((policy) =>
  policy.settings.filter((key) => !(key in EXTERNAL_SETTING_HOMES))
)

// Two independent stacks, not a grid of rows: a grid row is as tall as its
// tallest cell, so the six-setting `payment` section would open a hole beside
// itself. Reading order is column-major as a result.

const SECTION_BASE_UNITS = 120
/** The stack's own `gap-8` under each section. */
const SECTION_GAP_UNITS = 32
const SETTING_ROW_UNITS = 44
/** One wrapped line of `PolicyFacts` links. */
const FACT_LINE_UNITS = 18
/** The collapsed "Not posting" roll-up, which always closes the second column. */
export const NOT_POSTING_SECTION_UNITS = SECTION_BASE_UNITS + SECTION_GAP_UNITS

/**
 * Roughly how tall one policy's section renders, in arbitrary units.
 *
 * Only ever used to choose where to cut the list in two, so it need only be
 * right about which sections are the big ones.
 */
export function postingSectionUnits(policy: PostingPolicy): number {
  const inputKeys = policy.settings.filter((key) => !(key in EXTERNAL_SETTING_HOMES))
  const externalKeys = policy.settings.filter((key) => key in EXTERNAL_SETTING_HOMES)
  const factLines = (externalKeys.length > 0 ? 1 : 0) + ((policy.records?.length ?? 0) > 0 ? 1 : 0)

  return (
    SECTION_BASE_UNITS +
    SECTION_GAP_UNITS +
    inputKeys.length * SETTING_ROW_UNITS +
    factLines * FACT_LINE_UNITS
  )
}

/**
 * The declared order cut in two so both columns end at about the same height.
 *
 * Picks a boundary index; never reorders or interleaves. The "Not posting"
 * roll-up counts against the right column, which is where it renders.
 */
export function splitPostingColumns(policies: readonly PostingPolicy[]): {
  left: PostingPolicy[]
  right: PostingPolicy[]
} {
  const units = policies.map(postingSectionUnits)
  const total = units.reduce((sum, unit) => sum + unit, 0)

  let bestIndex = 0
  let bestGap = Number.POSITIVE_INFINITY
  let left = 0

  // `index` is how many sections the left column takes.
  for (let index = 0; index <= policies.length; index++) {
    const gap = Math.abs(left - (total - left + NOT_POSTING_SECTION_UNITS))
    if (gap < bestGap) {
      bestGap = gap
      bestIndex = index
    }
    left += units[index] ?? 0
  }

  return { left: [...policies.slice(0, bestIndex)], right: [...policies.slice(bestIndex)] }
}

/** A guide page: the overview, one page per posting type, or the never-posting roll-up. */
export type PostingGuidePage = 'overview' | 'not-posting' | PostingType

/** The guide page a bulk dialog's `sourceKey` deep-links to, or the overview when it is not a type. */
export function guidePageForSource(sourceKey: string): PostingGuidePage {
  return sourceKey in POSTING_POLICY ? (sourceKey as PostingType) : 'overview'
}
