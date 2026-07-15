// packages/lib/src/sequences/seed-templates.ts
// The 5 seeded client-notification sequences (client-notifications plan §4.6) — visit
// reminders, en-route, job follow-up, invoice reminders, and the opt-in visit follow-up. All
// seeded `status='disabled'`; the admin reviews + enables from the "Client notifications"
// settings page (decision #6, Phase 3 UI — not built here). Idempotent on
// `(organizationId, templateKey)` — `seedClientNotificationSequences` is a no-op for any
// templateKey the org already has. Called from both the new-org path
// (`organization-seeder.ts`) and the existing-org backfill
// (`scripts/backfill-client-notification-sequences.ts`).
//
// Compiled at seed (graph built + `publishedAt` stamped) so enabling later is a pure status
// flip — deliberately NOT via `publishSequence`: that function's business-rule validation
// requires `integrationId` to already be set, which a freshly-seeded org (or an existing org
// that hasn't connected a mailbox yet) doesn't have. `compileSequenceForSeed` below mirrors
// `publishSequence`'s graph-compile mechanics minus that one check, then forces `status`
// back to `'disabled'` regardless (seeded sequences are never auto-enabled, decision #6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { FallbackPayload } from '../placeholders/fallback-codec'
import type { TiptapDoc, TiptapNode } from '../tiptap'
import { SystemUserService } from '../users/system-user-service'
import { createSequence } from './crud'
import { buildSequenceGraph } from './publish'
import { createStep } from './steps'
import type {
  CreateSequenceInput,
  CreateStepInput,
  SequenceEntity,
  SequenceStepEntity,
  SequenceTriggerType,
} from './types'

const logger = createScopedLogger('sequences-seed-templates')

/** Build a canonical structural placeholder atom for a seeded sequence body. */
function placeholder(
  entityDefId: string,
  fieldKey: string,
  fallback?: FallbackPayload
): TiptapNode {
  return {
    type: 'placeholder',
    attrs: {
      id: `${entityDefId}:${fieldKey}`,
      ...(fallback ? { fallback } : {}),
    },
  }
}

/** Build one paragraph without serializing any intermediary HTML. */
function paragraph(...content: Array<string | TiptapNode>): TiptapNode {
  return {
    type: 'paragraph',
    content: content.map((part) =>
      typeof part === 'string' ? { type: 'text', text: part } : part
    ),
  }
}

/** Build the persisted JSON sequence email document. */
function sequenceBody(...content: TiptapNode[]): TiptapDoc {
  return { type: 'doc', content }
}

const CLOSING = paragraph('Let us know if you have any questions.')
const FIRST_NAME_FALLBACK: FallbackPayload = { v: 1, t: 'TEXT', d: 'there' }
const TITLE_FALLBACK: FallbackPayload = { v: 1, t: 'TEXT', d: 'your service' }

interface SeedStep {
  subject: string
  bodyJson: (entityDefs: Record<string, string>) => TiptapDoc
  timingMode: 'relative' | 'anchor'
  delayDays?: number
  anchorOffsetDays?: number
  anchorTimeOfDay?: string | null
}

interface SeedTemplate {
  templateKey: string
  name: string
  triggerType: SequenceTriggerType
  subjectKind: 'visit' | 'work_order' | 'invoice'
  steps: SeedStep[]
  exitOnReply: boolean
  respectSuppression: boolean
  includeUnsubscribeFooter: boolean
  /** Delivery window — `visit_en_route` is the only template seeded with none (decision #9:
   * en-route sends instantly). */
  deliveryWindow: { startTime: string; endTime: string } | null
}

/**
 * The 5 seeded templates (§4.6 table) — triggers/subjects/step timings/flags exactly as
 * specified. Email copy follows the `quote_email`/`invoice_email` tone (short greeting with a
 * `'there'` fallback, one factual sentence, a closing "any questions" line, no hard-coded
 * sign-off — the composer/send-node appends the sender's signature separately). Entity
 * placeholders (`contact:firstName`, `work_order:number`/`title`, `invoice:number`/`total`/
 * `dueDate`) are per-org `EntityDefinition`-id-keyed spans (§4.5). Visit fields are normal
 * system-resource spans keyed by their stable `visit` root.
 */
export const SEQUENCE_SEED_TEMPLATES: SeedTemplate[] = [
  {
    templateKey: 'visit_reminders',
    name: 'Visit reminders',
    triggerType: 'visit:scheduled',
    subjectKind: 'visit',
    exitOnReply: false,
    respectSuppression: false,
    includeUnsubscribeFooter: false,
    deliveryWindow: { startTime: '08:00', endTime: '20:00' },
    steps: [
      {
        subject: 'Your visit is booked',
        timingMode: 'relative',
        delayDays: 0,
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              "We've got you down for ",
              placeholder('visit', 'date'),
              ' from ',
              placeholder('visit', 'startTime'),
              ' to ',
              placeholder('visit', 'endTime'),
              ' for ',
              placeholder(defs.work_order!, 'title', TITLE_FALLBACK),
              ' (',
              placeholder(defs.work_order!, 'number'),
              ').'
            ),
            CLOSING
          ),
      },
      {
        subject: 'Reminder: your visit is coming up',
        timingMode: 'anchor',
        anchorOffsetDays: -2,
        anchorTimeOfDay: '09:00',
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              "Just a reminder — we'll see you on ",
              placeholder('visit', 'date'),
              ' at ',
              placeholder('visit', 'startTime'),
              '.'
            ),
            CLOSING
          ),
      },
      {
        subject: "We'll see you today",
        timingMode: 'anchor',
        anchorOffsetDays: 0,
        anchorTimeOfDay: '07:30',
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              "Today's the day! We'll be there at ",
              placeholder('visit', 'startTime'),
              '. ',
              placeholder('visit', 'assignee'),
              ' will be your technician.'
            ),
            CLOSING
          ),
      },
    ],
  },
  {
    templateKey: 'visit_en_route',
    name: 'On our way',
    triggerType: 'visit:en_route',
    subjectKind: 'visit',
    exitOnReply: false,
    respectSuppression: false,
    includeUnsubscribeFooter: false,
    deliveryWindow: null,
    steps: [
      {
        subject: "We're on our way",
        timingMode: 'relative',
        delayDays: 0,
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              'Just a heads up — ',
              placeholder('visit', 'assignee'),
              ' is on the way and should arrive around ',
              placeholder('visit', 'startTime'),
              '.'
            ),
            CLOSING
          ),
      },
    ],
  },
  {
    templateKey: 'job_follow_up',
    name: 'Job follow-up',
    triggerType: 'work_order:completed',
    subjectKind: 'work_order',
    exitOnReply: true,
    respectSuppression: false,
    includeUnsubscribeFooter: false,
    deliveryWindow: { startTime: '08:00', endTime: '20:00' },
    steps: [
      {
        subject: 'Thank you!',
        timingMode: 'relative',
        delayDays: 0,
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              'Thanks for choosing us for ',
              placeholder(defs.work_order!, 'title', TITLE_FALLBACK),
              ' (',
              placeholder(defs.work_order!, 'number'),
              '). We hope everything went well.'
            ),
            CLOSING
          ),
      },
      {
        subject: 'How did everything go?',
        timingMode: 'relative',
        delayDays: 10,
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              "It's been a little while since we completed ",
              placeholder(defs.work_order!, 'title', TITLE_FALLBACK),
              ". We'd love to hear how everything's holding up — and if you have a minute, a review would mean a lot."
            ),
            CLOSING
          ),
      },
    ],
  },
  {
    templateKey: 'invoice_reminders',
    name: 'Invoice reminders',
    triggerType: 'invoice:sent',
    subjectKind: 'invoice',
    exitOnReply: true,
    respectSuppression: false,
    includeUnsubscribeFooter: false,
    deliveryWindow: { startTime: '08:00', endTime: '20:00' },
    steps: [
      {
        subject: 'Your invoice is due soon',
        timingMode: 'anchor',
        anchorOffsetDays: -2,
        anchorTimeOfDay: '09:00',
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              'Just a reminder that invoice ',
              placeholder(defs.invoice!, 'number'),
              ' for ',
              placeholder(defs.invoice!, 'total'),
              ' is due ',
              placeholder(defs.invoice!, 'dueDate', {
                v: 1,
                t: 'DATE',
                d: 'soon',
              }),
              '.'
            ),
            CLOSING
          ),
      },
      {
        subject: 'Your invoice is overdue',
        timingMode: 'anchor',
        anchorOffsetDays: 3,
        anchorTimeOfDay: '09:00',
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              'Invoice ',
              placeholder(defs.invoice!, 'number'),
              ' for ',
              placeholder(defs.invoice!, 'total'),
              ' was due ',
              placeholder(defs.invoice!, 'dueDate', {
                v: 1,
                t: 'DATE',
                d: 'recently',
              }),
              ' and is now overdue. Please let us know if you have any questions about payment.'
            )
          ),
      },
      {
        subject: 'Invoice still outstanding',
        timingMode: 'anchor',
        anchorOffsetDays: 10,
        anchorTimeOfDay: '09:00',
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              'Invoice ',
              placeholder(defs.invoice!, 'number'),
              ' for ',
              placeholder(defs.invoice!, 'total'),
              " is still outstanding. Please reach out if there's anything we can help with."
            )
          ),
      },
    ],
  },
  {
    templateKey: 'visit_follow_up',
    name: 'Visit follow-up',
    triggerType: 'visit:completed',
    subjectKind: 'visit',
    exitOnReply: true,
    respectSuppression: false,
    includeUnsubscribeFooter: false,
    deliveryWindow: { startTime: '08:00', endTime: '20:00' },
    steps: [
      {
        subject: 'Thanks — see you next time',
        timingMode: 'relative',
        delayDays: 0,
        bodyJson: (defs) =>
          sequenceBody(
            paragraph('Hi ', placeholder(defs.contact!, 'firstName', FIRST_NAME_FALLBACK), ','),
            paragraph(
              'Thank you for having us out on ',
              placeholder('visit', 'date'),
              '. We hope everything went well — see you next time!'
            ),
            CLOSING
          ),
      },
    ],
  },
]

async function resolveOrgEntityDefs(
  db: Database,
  organizationId: string
): Promise<Record<string, string>> {
  const defs = await db
    .select({
      entityType: schema.EntityDefinition.entityType,
      id: schema.EntityDefinition.id,
    })
    .from(schema.EntityDefinition)
    .where(eq(schema.EntityDefinition.organizationId, organizationId))
  const map: Record<string, string> = {}
  for (const def of defs) {
    if (def.entityType) map[def.entityType] = def.id
  }
  return map
}

/** Compile + mark published WITHOUT `publishSequence`'s integration-required validation (see
 * file header) — then force `status` back to `'disabled'` (seeded sequences are never
 * auto-enabled). */
async function compileSequenceForSeed(
  db: Database,
  sequence: SequenceEntity,
  steps: SequenceStepEntity[]
): Promise<void> {
  const workflowApp = await db.query.WorkflowApp.findFirst({
    where: eq(schema.WorkflowApp.id, sequence.workflowAppId),
  })
  if (!workflowApp?.workflowId) {
    throw new Error(`Seeded sequence ${sequence.id} is missing its hidden workflow`)
  }
  const graph = buildSequenceGraph(sequence, steps)
  const now = new Date()
  await db
    .update(schema.Workflow)
    .set({ graph: graph as unknown as Record<string, unknown>, updatedAt: now })
    .where(eq(schema.Workflow.id, workflowApp.workflowId))
  await db
    .update(schema.Sequence)
    .set({ publishedAt: now, hasUnpublishedChanges: false, status: 'disabled' })
    .where(eq(schema.Sequence.id, sequence.id))
}

/**
 * Seed the 5 client-notification sequences for an org — idempotent on
 * `(organizationId, templateKey)`, skips any template the org already has. No-ops (with a
 * warning) if the org's `contact`/`work_order`/`invoice` `EntityDefinition`s don't exist yet
 * (seeded before this runs in `organization-seeder.ts`'s `seedEntities` step; should never
 * happen on the backfill path against a live org).
 */
export async function seedClientNotificationSequences(
  db: Database,
  organizationId: string
): Promise<void> {
  const entityDefs = await resolveOrgEntityDefs(db, organizationId)
  if (!entityDefs.contact || !entityDefs.work_order || !entityDefs.invoice) {
    logger.warn('Skipping client-notification sequence seed — entity defs not ready yet', {
      organizationId,
    })
    return
  }

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

  for (const template of SEQUENCE_SEED_TEMPLATES) {
    const existing = await db.query.Sequence.findFirst({
      where: and(
        eq(schema.Sequence.organizationId, organizationId),
        eq(schema.Sequence.templateKey, template.templateKey)
      ),
      columns: { id: true },
    })
    if (existing) continue

    const createInput: CreateSequenceInput = {
      organizationId,
      name: template.name,
      createdById: systemUserId,
      triggerType: template.triggerType,
      subjectKind: template.subjectKind,
      exitOnReply: template.exitOnReply,
      respectSuppression: template.respectSuppression,
      includeUnsubscribeFooter: template.includeUnsubscribeFooter,
      templateKey: template.templateKey,
      deliveryStartTime: template.deliveryWindow?.startTime ?? null,
      deliveryEndTime: template.deliveryWindow?.endTime ?? null,
      deliveryTimezone: template.deliveryWindow ? 'UTC' : null,
      deliveryBusinessDaysOnly: false,
    }

    const created = await createSequence(db, createInput)
    if (created.isErr()) {
      logger.error('Failed to seed sequence', {
        organizationId,
        templateKey: template.templateKey,
        error: created.error.message,
      })
      continue
    }
    const sequence = created.value

    const steps: SequenceStepEntity[] = []
    for (const step of template.steps) {
      const stepInput: CreateStepInput = {
        sequenceId: sequence.id,
        organizationId,
        subject: step.subject,
        bodyJson: step.bodyJson(entityDefs) as unknown as Record<string, unknown>,
        delayDays: step.timingMode === 'relative' ? (step.delayDays ?? 0) : 0,
        delayHours: 0,
        timingMode: step.timingMode,
        anchorOffsetDays: step.anchorOffsetDays ?? 0,
        anchorTimeOfDay: step.anchorTimeOfDay ?? null,
      }
      const createdStep = await createStep(db, stepInput)
      if (createdStep.isErr()) {
        logger.error('Failed to seed sequence step', {
          organizationId,
          templateKey: template.templateKey,
          error: createdStep.error.message,
        })
        continue
      }
      steps.push(createdStep.value)
    }

    try {
      await compileSequenceForSeed(db, sequence, steps)
    } catch (error) {
      logger.error('Failed to compile seeded sequence', {
        organizationId,
        templateKey: template.templateKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
