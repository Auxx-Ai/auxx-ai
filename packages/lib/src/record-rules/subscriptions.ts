// packages/lib/src/record-rules/subscriptions.ts
// Subscription index over the cached record-rule set: which fields / lifecycle events
// each entity def has ≥1 ENABLED rule for. Producers (connector sink, import job) use
// this to accumulate a sync-change manifest ONLY for what a rule can consume — orgs
// with no subscriptions on a def pay zero extra reads (see B2 plan D4).

import type { CachedRecordRule } from './types'
import { FIELD_TRANSITIONS, LIFECYCLE_TRANSITIONS } from './types'

/** Per-def subscription buckets. */
export interface DefSubscriptions {
  /** Canonical CustomField row ids referenced by enabled FIELD rules on this def. */
  fieldIds: Set<string>
  /** Whether the def has an enabled lifecycle rule for each transition. */
  lifecycle: { created: boolean; deleted: boolean }
}

/** entityDefinitionId → subscription buckets (only defs with ≥1 enabled rule). */
export type SyncRuleSubscriptions = Record<string, DefSubscriptions>

const FIELD_SET = new Set<string>(FIELD_TRANSITIONS)
const LIFECYCLE_SET = new Set<string>(LIFECYCLE_TRANSITIONS)

/**
 * Build the subscription index from the org's cached record rules. Pure — no DB.
 * Disabled rules are excluded. Field rules (`fieldId` set, field transition) contribute
 * their fieldId; lifecycle rules (`fieldId` null, `created`/`deleted`) flip the
 * corresponding lifecycle flag.
 */
export function getSyncRuleSubscriptions(rules: CachedRecordRule[]): SyncRuleSubscriptions {
  const subs: SyncRuleSubscriptions = {}

  const bucket = (defId: string): DefSubscriptions => {
    let entry = subs[defId]
    if (!entry) {
      entry = { fieldIds: new Set<string>(), lifecycle: { created: false, deleted: false } }
      subs[defId] = entry
    }
    return entry
  }

  for (const rule of rules) {
    if (!rule.enabled) continue

    if (rule.fieldId && FIELD_SET.has(rule.on)) {
      bucket(rule.entityDefinitionId).fieldIds.add(rule.fieldId)
      continue
    }

    if (rule.fieldId === null && LIFECYCLE_SET.has(rule.on)) {
      const entry = bucket(rule.entityDefinitionId)
      if (rule.on === 'created') entry.lifecycle.created = true
      if (rule.on === 'deleted') entry.lifecycle.deleted = true
    }
  }

  return subs
}

/** True when no def has any subscription — producers can skip all accumulation. */
export function subscriptionsEmpty(subs: SyncRuleSubscriptions): boolean {
  return Object.keys(subs).length === 0
}
