// packages/lib/src/field-hooks/register-hooks.ts

import { registerInventoryDeductionRule } from '../data-connectors/inventory-bridge-rule-action'
import { handleRecordRulesOnFieldChange } from '../record-rules/hook-handler'
import { invalidateInboxCacheOnFieldChange } from './post/inbox-cache-invalidation'
import { publishFieldChangeEvent } from './post/publish-field-change-event'
import { touchActivityOnFieldChange } from './post/touch-activity-on-field-change'
import { guardInboxDefaultLens } from './pre/inbox-lens-guard'
import { guardInboxPersonalFields } from './pre/inbox-personal-guard'
import {
  dropUnauthorizedSystemFlag,
  rejectDeleteIfSystemTag,
  rejectIfSystemTag,
} from './pre/tag-system-guard'
import {
  registerEntityFieldChangeHooks,
  registerEntityPreDeleteHooks,
  registerFieldPreHooks,
} from './registry'
import { registerEntitySystemRules } from './system-entity-rules'
import { registerFieldSystemRules } from './system-record-rules'

/**
 * Register all field and entity hooks (pre + post).
 * Called once at startup (e.g., from the worker entry point).
 */
export function registerAllHooks(): void {
  // ---------------------------------------------------------------------------
  // POST-WRITE TRIGGERS
  // ---------------------------------------------------------------------------

  // BOM cost / stock-status FIELD triggers migrated onto the record-rules engine as
  // server-declared system rules with native actions (B2 §8). Declared + handlers
  // registered here so both web and worker see them once the bootstrap runs.
  registerFieldSystemRules()

  // BOM cost / stock explode+QoH / company enrichment ENTITY triggers migrated onto the
  // record-rules engine as lifecycle system rules with native actions (B2 §9). They now
  // dispatch through door 2 (`handleRecordRules`) + the manifest consumer, so they gain
  // sync/import visibility for free. Replaces the deleted ENTITY_TRIGGERS registry.
  registerEntitySystemRules()

  // v9 inventory→part deduction: the `deductInventory` native action fired by the managed
  // inventory rule(s). Registered here so both web + worker resolve the handler once the
  // field-hooks bootstrap runs (the engine self-inits this on a first handler miss).
  registerInventoryDeductionRule()

  // Field-change post-hook — fires `<prefix>:field:updated` after every field
  // write. Registered globally so contacts, tickets, companies, and custom
  // entities all produce timeline entries.
  // handleRecordRulesOnFieldChange dispatches org-configured RecordRules (it
  // no-ops fast when the org has none and lazy-imports its own internals).
  registerEntityFieldChangeHooks('*', [
    publishFieldChangeEvent,
    touchActivityOnFieldChange,
    handleRecordRulesOnFieldChange,
  ])

  // Inbox cache coherence (mail-permissions §7.1): the generic records path
  // (form edits, Kopilot record tools, workflow CRUD) bypasses InboxService
  // and emitted no cache events — any inbox field write now busts
  // `org:inboxes`, and lens changes recompute every member's visibility.
  registerEntityFieldChangeHooks('inboxes', [invalidateInboxCacheOnFieldChange])

  // ---------------------------------------------------------------------------
  // PRE-WRITE HOOKS
  // ---------------------------------------------------------------------------

  // System tag guard — makes seeded tags read-only for end users.
  // - is_system_tag: drop any write that isn't bypassed by the seeder.
  // - title / description / emoji / color / parent: reject edits when the
  //   record's is_system_tag is true.
  // - pre-delete: reject deletes of system tags.
  // Inbox floor wall (mail-permissions §7.1) — only managers may change the
  // floor, and sub-`full` floors are enterprise-gated. This hook is the
  // actual enforcement; the inbox form / InboxService are just ergonomics.
  registerFieldPreHooks('inboxes', 'inbox_default_lens', [guardInboxDefaultLens])

  // Personal-inbox marker wall (§11) — system paths stamp these; user writes
  // are admin-only (claim/convert).
  registerFieldPreHooks('inboxes', 'inbox_is_personal', [guardInboxPersonalFields])
  registerFieldPreHooks('inboxes', 'inbox_owner_user_id', [guardInboxPersonalFields])

  registerFieldPreHooks('tags', 'is_system_tag', [dropUnauthorizedSystemFlag])
  registerFieldPreHooks('tags', 'title', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_description', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_emoji', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_color', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_parent', [rejectIfSystemTag])
  registerEntityPreDeleteHooks('tags', [rejectDeleteIfSystemTag])
}
