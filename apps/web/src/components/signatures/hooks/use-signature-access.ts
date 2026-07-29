// apps/web/src/components/signatures/hooks/use-signature-access.ts
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'

/** The three per-signature rungs plus the coarse "may create one" gate. */
export interface SignatureAccess {
  /** `view` — see it in the list, stamp it on a reply, make it your default. */
  canView: boolean
  /** `edit` — change its name or body. */
  canEdit: boolean
  /** `admin` — share it or delete it. */
  canAdmin: boolean
  /** Coarse `signatures.manage` — creating a NEW signature is not per-instance. */
  canCreate: boolean
}

/**
 * Per-signature instance access for the client (plan 36 §8) — the signature twin
 * of {@link import('~/components/agents/hooks/use-agent-access').useAgentAccess},
 * keyed by the signature's `EntityInstance.id`.
 *
 * **This is the single client authority for signature affordances.** Every
 * edit / delete / share / read-only decision in `~/components/signatures/**`
 * reads it, so the tier vocabulary lives in one place rather than being spelled
 * out per call site. Server enforcement is the source of truth
 * (`~/server/lib/signature-instance-access.ts`); this is degrade-only, to avoid
 * rendering affordances that 403.
 *
 * **The no-id fallback differs from agents, deliberately.** Agents are
 * `baselineAtCreate: false`, so `useAgentAccess` can fall back to the coarse
 * area rungs and still agree with the per-instance answer for every unrestricted
 * agent. Signatures are `baselineAtCreate: true` (§0.2): an instance with no
 * explicit `ResourceAccess` row resolves to NO access, so the coarse area level
 * says nothing about any particular signature and falling back to it would
 * render edit/share affordances that the server refuses. With no id the three
 * instance rungs are therefore `false`, and only `canCreate` — which genuinely
 * is instance-less — reads a `PermissionKey`.
 *
 * MUST be called inside `CapabilitiesProvider` (i.e. `(protected)` surfaces).
 *
 * @param signatureId The signature's `EntityInstance.id`, or null/undefined
 *   before it resolves (create mode).
 */
export function useSignatureAccess(signatureId?: string | null): SignatureAccess {
  const { can, canViewInstance, canEditInstance, canAdminInstance } = useAccess()

  return useMemo(() => {
    const canCreate = can(PermissionKey.signaturesManage)
    if (!signatureId) {
      return { canView: false, canEdit: false, canAdmin: false, canCreate }
    }
    const recordId = toRecordId('signature', signatureId)
    return {
      canView: canViewInstance(recordId),
      canEdit: canEditInstance(recordId),
      canAdmin: canAdminInstance(recordId),
      canCreate,
    }
  }, [signatureId, can, canViewInstance, canEditInstance, canAdminInstance])
}
