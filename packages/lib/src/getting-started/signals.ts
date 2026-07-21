// packages/lib/src/getting-started/signals.ts
// Per-goal completion signals, auto-inferred from live org state, keyed by checklist.
// Every `main` signal subtracts seeded defaults so a fresh org reads as "nothing done yet":
//   - email:    seeded mailboxes are `enabled: false` (example also isExample)
//   - workflow: the example scenario seeds `[Example] …`-named workflows
//   - members:  AI agents are synthetic users (userType !== 'USER')
//   - agents:   no agent is seeded; a real one has name + setupCompletedAt set
// `dispatch` signals are plain existence checks — no seeded example workers/records exist.
// Reads come from the per-org cache; only limit-1 DB lookups touch the database directly.

import { database, schema } from '@auxx/database'
import { and, eq, isNotNull } from 'drizzle-orm'
import {
  getAllCachedCustomFields,
  getCachedAgents,
  getCachedEntityDefId,
  getCachedMembers,
  getOrgCache,
} from '../cache'
import type { ChecklistId, GoalKey } from './client'
import type { GettingStartedContext } from './types'

type Signal = (ctx: GettingStartedContext) => Promise<boolean>

// ── main checklist signals ──

/** A real, enabled inbound mailbox (Gmail/Outlook) that isn't seeded demo data. */
async function isEmailConnected(ctx: GettingStartedContext): Promise<boolean> {
  const channels = await getOrgCache().get(ctx.organizationId, 'channels')
  return channels.some(
    (c) => (c.provider === 'google' || c.provider === 'outlook') && c.enabled && !c.isExample
  )
}

/** At least one set-up (non-draft) agent. Drafts lack `setupCompletedAt`. */
async function hasConfiguredAgent(ctx: GettingStartedContext): Promise<boolean> {
  const agents = await getCachedAgents(ctx.organizationId)
  return agents.some((a) => a.name !== null && a.setupCompletedAt !== null)
}

/** A user-authored workflow — i.e. not a seeded `[Example] …` one. */
async function hasUserWorkflow(ctx: GettingStartedContext): Promise<boolean> {
  const workflows = await getOrgCache().get(ctx.organizationId, 'workflowApps')
  return workflows.some((w) => !w.name.startsWith('[Example]'))
}

/** A genuinely custom field — not a system attribute, not app-provisioned. */
async function hasCustomField(ctx: GettingStartedContext): Promise<boolean> {
  const fields = await getAllCachedCustomFields(ctx.organizationId)
  return fields.some(
    (f) => f.isCustom && f.systemAttribute === null && f.appInstallationId === null
  )
}

/** More than one human member, or a pending human invitation. */
async function hasHumanTeammate(ctx: GettingStartedContext): Promise<boolean> {
  const members = await getCachedMembers(ctx.organizationId)
  const humans = members.filter((m) => m.user?.userType === 'USER')
  if (humans.length > 1) return true

  // A teammate who was invited but hasn't accepted yet still counts — that's
  // exactly the action this goal asks for. Agents are never email-invited, so
  // any pending invitation is human.
  const db = ctx.db ?? database
  const pending = await db
    .select({ id: schema.OrganizationInvitation.id })
    .from(schema.OrganizationInvitation)
    .where(
      and(
        eq(schema.OrganizationInvitation.organizationId, ctx.organizationId),
        eq(schema.OrganizationInvitation.status, 'PENDING')
      )
    )
    .limit(1)
  return pending.length > 0
}

// ── dispatch checklist signals ──

/** At least one `DispatchWorker` row for the org — active or not, any counts. */
async function hasWorkers(ctx: GettingStartedContext): Promise<boolean> {
  const db = ctx.db ?? database
  const rows = await db
    .select({ id: schema.DispatchWorker.id })
    .from(schema.DispatchWorker)
    .where(eq(schema.DispatchWorker.organizationId, ctx.organizationId))
    .limit(1)
  return rows.length > 0
}

/** `documents.business` has a filled-in address — canonical `street1`/`city`, or the legacy `line1`/`city` shape. */
async function hasBusinessAddress(ctx: GettingStartedContext): Promise<boolean> {
  const settings = await getOrgCache().get(ctx.organizationId, 'orgSettings')
  const business = settings['documents.business'] as
    | { address?: { street1?: string; city?: string; line1?: string } }
    | undefined
  const address = business?.address
  if (!address) return false
  const hasCanonical = Boolean(address.street1?.trim() && address.city?.trim())
  const hasLegacy = Boolean(address.line1?.trim() && address.city?.trim())
  return hasCanonical || hasLegacy
}

/** Any `OperatingHours` row (weekly or exception) on the organization subject. */
async function hasOrgHours(ctx: GettingStartedContext): Promise<boolean> {
  const db = ctx.db ?? database
  const rows = await db
    .select({ id: schema.OperatingHours.id })
    .from(schema.OperatingHours)
    .where(
      and(
        eq(schema.OperatingHours.organizationId, ctx.organizationId),
        eq(schema.OperatingHours.subjectType, 'organization')
      )
    )
    .limit(1)
  return rows.length > 0
}

/** At least one `EntityInstance` of the given system entity type, for this org. */
async function hasEntityInstance(ctx: GettingStartedContext, entityType: string): Promise<boolean> {
  const entityDefinitionId = await getCachedEntityDefId(ctx.organizationId, entityType)
  if (!entityDefinitionId) return false
  const db = ctx.db ?? database
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, ctx.organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
      )
    )
    .limit(1)
  return rows.length > 0
}

const hasServiceRequest = (ctx: GettingStartedContext) => hasEntityInstance(ctx, 'service_request')
const hasWorkOrder = (ctx: GettingStartedContext) => hasEntityInstance(ctx, 'work_order')

/** At least one `WorkOrderVisit` that was ever scheduled (has a `startTime`) — canceled counts. */
async function hasScheduledVisit(ctx: GettingStartedContext): Promise<boolean> {
  const db = ctx.db ?? database
  const rows = await db
    .select({ id: schema.WorkOrderVisit.id })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, ctx.organizationId),
        isNotNull(schema.WorkOrderVisit.startTime)
      )
    )
    .limit(1)
  return rows.length > 0
}

/** Map of checklist → auto-inferred goal → signal. Manual-only goals have no entry. */
const AUTO_SIGNALS: Record<ChecklistId, Partial<Record<GoalKey, Signal>>> = {
  main: {
    'connect-email': isEmailConnected,
    'setup-agent': hasConfiguredAgent,
    'create-workflow': hasUserWorkflow,
    'create-field': hasCustomField,
    'invite-team': hasHumanTeammate,
  },
  dispatch: {
    'add-workers': hasWorkers,
    'set-address': hasBusinessAddress,
    'set-hours': hasOrgHours,
    'create-request': hasServiceRequest,
    'create-work-order': hasWorkOrder,
    'schedule-visit': hasScheduledVisit,
  },
}

/**
 * Compute the set of auto-inferred completed goal keys for a checklist. Runs
 * all of that checklist's signals concurrently against the per-org cache.
 */
export async function getAutoInferredGoals(
  ctx: GettingStartedContext,
  checklistId: ChecklistId
): Promise<GoalKey[]> {
  const entries = Object.entries(AUTO_SIGNALS[checklistId]) as Array<[GoalKey, Signal]>
  const results = await Promise.all(entries.map(([, signal]) => signal(ctx)))
  return entries.filter((_, i) => results[i]).map(([key]) => key)
}
