// packages/lib/src/field-hooks/register-hooks.ts

import { handleRecordRulesOnFieldChange } from '../record-rules/hook-handler'
import { publishFieldChangeEvent } from './post/publish-field-change-event'
import { touchActivityOnFieldChange } from './post/touch-activity-on-field-change'
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

  // ---------------------------------------------------------------------------
  // PRE-WRITE HOOKS
  // ---------------------------------------------------------------------------

  // System tag guard — makes seeded tags read-only for end users.
  // - is_system_tag: drop any write that isn't bypassed by the seeder.
  // - title / description / emoji / color / parent: reject edits when the
  //   record's is_system_tag is true.
  // - pre-delete: reject deletes of system tags.
  registerFieldPreHooks('tags', 'is_system_tag', [dropUnauthorizedSystemFlag])
  registerFieldPreHooks('tags', 'title', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_description', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_emoji', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_color', [rejectIfSystemTag])
  registerFieldPreHooks('tags', 'tag_parent', [rejectIfSystemTag])
  registerEntityPreDeleteHooks('tags', [rejectDeleteIfSystemTag])
}
