// packages/lib/src/record-rules/seed-suggested-rules.ts
// Starter suggested record rules (plans/signals/06-follow-ups-build.md Step 6, decision 8) —
// three disabled, plain user-editable rules seeded on the contact `EntityDefinition`, giving
// new orgs a starting point for signal-triggered follow-ups. Idempotent on
// `(organizationId, templateKey)` (`RecordRule_organizationId_templateKey_idx`), mirroring
// `sequences/seed-templates.ts`: skips silently (never overwrites) any templateKey the org
// already has, including one the user has since edited or re-enabled/disabled.
//
// Build-time check #2 (plan "Open build-time checks"): no Do-Not-Contact / email-invalid
// field convention exists on the contact `EntityDefinition` today
// (`resources/registry/resources/contact-fields.ts` has no such field — verified
// 2026-07-21), so the unsubscribe/bounce starters below are task-only (no `set-field`
// action), per the plan's documented fallback.
//
// Goes through `assertRuleShape` (the same validator the tRPC create/update path uses) before
// insert — NOT a raw unvalidated insert — but writes the row directly (rather than calling
// `createRecordRule`) because that store helper doesn't accept `templateKey`.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { ConditionGroup } from '../conditions/types'
import { legacyActionTextToDoc } from './client'
import { assertRuleShape } from './store'
import type { CreateTaskAction, RecordRuleAction } from './types'

const logger = createScopedLogger('record-rules-seed-suggested')

interface SuggestedRuleTemplate {
  templateKey: string
  name: string
  signalKind: string
  condition: ConditionGroup[]
  actions: RecordRuleAction[]
}

/** `signal:openCount30d >= 3 AND signal:lastRepliedAt is empty` (decision 6/Step 6 #3). */
const HOT_CONTACT_CONDITION: ConditionGroup[] = [
  {
    id: 'g1',
    logicalOperator: 'AND',
    conditions: [
      { id: 'c1', fieldId: 'signal:openCount30d', operator: '>=', value: 3 },
      { id: 'c2', fieldId: 'signal:lastRepliedAt', operator: 'empty', value: undefined },
    ],
  },
]

/** The 3 starter suggested rules (Step 6). All fire on the contact def, seeded `enabled: false`. */
export const SUGGESTED_RECORD_RULE_TEMPLATES: SuggestedRuleTemplate[] = [
  {
    templateKey: 'suggested:unsubscribe-flag',
    name: 'Review unsubscribe',
    signalKind: 'contact:unsubscribed',
    condition: [],
    actions: [
      {
        type: 'create-task',
        title: legacyActionTextToDoc('Review unsubscribe from {{record}}'),
      } satisfies CreateTaskAction,
    ],
  },
  {
    templateKey: 'suggested:hard-bounce-review',
    name: 'Fix invalid email',
    signalKind: 'email:bounced',
    condition: [],
    actions: [
      {
        type: 'create-task',
        title: legacyActionTextToDoc('Fix invalid email for {{record}}'),
      } satisfies CreateTaskAction,
    ],
  },
  {
    templateKey: 'suggested:hot-contact-follow-up',
    name: 'Hot contact follow-up',
    signalKind: 'email:opened',
    condition: HOT_CONTACT_CONDITION,
    actions: [
      {
        type: 'create-task',
        title: legacyActionTextToDoc('Follow up with {{record}} — opening but not replying'),
        autoCompleteOn: 'contact_reply',
        deadlineDays: 2,
      } satisfies CreateTaskAction,
    ],
  },
]

/**
 * Seed the 3 starter suggested record rules (decision 8) for an org — idempotent on
 * `(organizationId, templateKey)`, skips any template the org already has (never overwrites a
 * user's edits). All rows: `on: 'signal'`, contact `EntityDefinition`, `enabled: false`,
 * plain user-editable (`managed: null`). No-ops (with a warning) if the org's `contact` def
 * doesn't exist yet (seeded before this runs in `organization-seeder.ts`'s `seedEntities`
 * step; should never happen on the backfill path against a live org).
 */
export async function seedSuggestedRecordRules(
  db: Database,
  organizationId: string
): Promise<void> {
  const [contactDef] = await db
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'contact')
      )
    )
    .limit(1)

  if (!contactDef) {
    logger.warn('Skipping suggested record-rule seed — contact entity def not ready yet', {
      organizationId,
    })
    return
  }

  for (const template of SUGGESTED_RECORD_RULE_TEMPLATES) {
    const existing = await db.query.RecordRule.findFirst({
      where: and(
        eq(schema.RecordRule.organizationId, organizationId),
        eq(schema.RecordRule.templateKey, template.templateKey)
      ),
      columns: { id: true },
    })
    if (existing) continue

    const shapeInput = {
      fieldId: null,
      on: 'signal' as const,
      signalKind: template.signalKind,
      actions: template.actions,
      condition: template.condition,
    }

    try {
      assertRuleShape(shapeInput)
    } catch (error) {
      logger.error('Suggested record-rule template failed shape validation — not seeded', {
        organizationId,
        templateKey: template.templateKey,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    try {
      await db.insert(schema.RecordRule).values({
        organizationId,
        entityDefinitionId: contactDef.id,
        fieldId: null,
        name: template.name,
        on: 'signal',
        signalKind: template.signalKind,
        condition: template.condition,
        actions: template.actions,
        enabled: false,
        templateKey: template.templateKey,
      })
    } catch (error) {
      logger.error('Failed to seed suggested record rule', {
        organizationId,
        templateKey: template.templateKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
