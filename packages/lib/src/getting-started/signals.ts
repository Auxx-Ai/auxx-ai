// packages/lib/src/getting-started/signals.ts
// Per-goal completion signals, auto-inferred from live org state. Every signal
// subtracts seeded defaults so a fresh org reads as "nothing done yet":
//   - email:    seeded mailboxes are `enabled: false` (example also isExample)
//   - workflow: the example scenario seeds `[Example] …`-named workflows
//   - members:  AI agents are synthetic users (userType !== 'USER')
//   - agents:   no agent is seeded; a real one has name + setupCompletedAt set
// Reads come from the per-org cache; only the pending-invite check touches the DB.

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getAllCachedCustomFields, getCachedAgents, getCachedMembers, getOrgCache } from '../cache'
import type { GoalKey } from './client'
import type { GettingStartedContext } from './types'

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

/** Map of auto-inferred goal → signal. `install-extension` has no signal. */
const AUTO_SIGNALS: Partial<Record<GoalKey, (ctx: GettingStartedContext) => Promise<boolean>>> = {
  'connect-email': isEmailConnected,
  'setup-agent': hasConfiguredAgent,
  'create-workflow': hasUserWorkflow,
  'create-field': hasCustomField,
  'invite-team': hasHumanTeammate,
}

/**
 * Compute the set of auto-inferred completed goal keys for an org. Runs all
 * signals concurrently against the per-org cache.
 */
export async function getAutoInferredGoals(ctx: GettingStartedContext): Promise<GoalKey[]> {
  const entries = Object.entries(AUTO_SIGNALS) as Array<
    [GoalKey, (ctx: GettingStartedContext) => Promise<boolean>]
  >
  const results = await Promise.all(entries.map(([, signal]) => signal(ctx)))
  return entries.filter((_, i) => results[i]).map(([key]) => key)
}
