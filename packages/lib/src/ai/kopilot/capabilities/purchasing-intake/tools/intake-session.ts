// packages/lib/src/ai/kopilot/capabilities/purchasing-intake/tools/intake-session.ts

import type { Database } from '@auxx/database'
import { getCachedEntityDefId } from '../../../../../cache'
import type { CapabilityView } from '../../../../../permissions/capabilities/capability-view'
import type {
  IntakeDraftPayload,
  IntakeDraftView,
  IntakeTier,
} from '../../../../../purchasing/intake/client'
import { getIntakeDraft } from '../../../../../purchasing/intake/draft-queries'
import type { AgentDeps } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

/**
 * Session-ref kind the intake page mounts. 🛑 The draft is resolved from the
 * ref, never from a tool argument: a `draftId` parameter is a string the model
 * emits, and a string the model emits can name another org's draft. Same
 * mechanic `agents-builder` uses for its `agent` ref (§4.1).
 */
export const INTAKE_DRAFT_REF_KIND = 'intakeDraft' as const

/** Everything both tools resolve before they touch anything. */
export interface IntakeSession {
  db: Database
  organizationId: string
  /** Never `undefined` — {@link resolveIntakeSession} fails closed first. */
  capabilities: CapabilityView
  draftId: string
  draft: IntakeDraftView
  /** `null` until the transcription step has written one. */
  payload: IntakeDraftPayload | null
}

export type IntakeSessionResult =
  | { ok: true; session: IntakeSession }
  | { ok: false; error: string }

/**
 * Resolve the draft this turn is drafting against, fail-closed.
 *
 * 🛑 `ToolDeps.capabilities` carries the INVOKING user's `CapabilityView` and
 * must never be `undefined` on this page. Its own comment lists the only
 * legitimate `undefined` callers — the workflow AI node, master-Kopilot job
 * runs, pre-setup drafts — and a run that drafts a financial record is not one
 * of them (§4.1). An unrestricted intake run would resolve parts the invoker
 * cannot see and stage them onto a purchase order they cannot read.
 */
export async function resolveIntakeSession(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps
): Promise<IntakeSessionResult> {
  const deps = getDeps()
  if (!deps.capabilities) {
    return {
      ok: false,
      error:
        'Purchase-order intake cannot run without a resolved capability view. This run was ' +
        'constructed with `capabilities: undefined`, which means unrestricted — refused rather ' +
        'than drafting a financial record with no read enforcement.',
    }
  }

  const ref = findRef(deps.sessionContext, INTAKE_DRAFT_REF_KIND)
  if (!ref?.id) {
    return {
      ok: false,
      error:
        'No intake draft is in session context. This page must be opened with an ' +
        '`intakeDraft` reference; there is no draft id argument to supply.',
    }
  }

  const organizationId = agentDeps.organizationId
  const draft = await getIntakeDraft(organizationId, ref.id)
  if (draft.isErr()) {
    return { ok: false, error: `Could not read intake draft ${ref.id}: ${draft.error.message}` }
  }

  return {
    ok: true,
    session: {
      db: deps.db,
      organizationId,
      capabilities: deps.capabilities,
      draftId: draft.value.id,
      draft: draft.value,
      payload: draft.value.payload,
    },
  }
}

/**
 * Definition-level read gate for one system def slug.
 *
 * Returns an LLM-actionable refusal string, or `null` when the caller may read
 * the def. A def the org has not provisioned resolves to no id and is treated
 * as "nothing to gate" — the downstream read returns nothing anyway.
 */
export async function refuseUnlessDefViewable(
  organizationId: string,
  capabilities: CapabilityView,
  slug: string
): Promise<string | null> {
  const defId = await getCachedEntityDefId(organizationId, slug)
  if (!defId) return null
  if (capabilities.canViewEntity(defId)) return null
  return `You do not have read access to \`${slug}\` in this workspace, so this quote cannot be drafted. Say so rather than guessing at the match.`
}

/**
 * How much weight the ladder's answer carries, derived from the tier alone.
 *
 * ⚠️ `sku` is NOT the same strength as `vendor_sku` even though both are exact
 * matches: tier 2 is vendor-blind by construction and two vendors can print our
 * SKU for different goods (§5.2). `fuzzy` never auto-links.
 */
export function tierConfidence(tier: IntakeTier): 'high' | 'medium' | 'low' | 'none' {
  switch (tier) {
    case 'vendor_sku':
      return 'high'
    case 'sku':
      return 'medium'
    case 'fuzzy':
      return 'low'
    default:
      return 'none'
  }
}
