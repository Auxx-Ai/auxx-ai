// apps/web/src/components/workflow/hooks/use-workflow-access.ts
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { useWorkflowStore } from '../store/workflow-store'

/** The three per-workflow rungs plus the coarse "may create a workflow" gate. */
export interface WorkflowAccess {
  /** `view` — open the workflow read-only and run it manually from a record. */
  canView: boolean
  /** `edit` — edit nodes, save, publish, test-run, manage versions. */
  canEdit: boolean
  /** `admin` — settings, rename, delete, duplicate, public/API share tokens. */
  canAdmin: boolean
  /** Coarse `workflows.manage` — creating a NEW workflow is not per-instance. */
  canCreate: boolean
}

/**
 * Per-workflow instance access for the client (plan 30 §4) — the workflow twin
 * of `useAccess().canViewInstance/canEditInstance/canAdminInstance`, keyed by
 * `WorkflowApp.id`.
 *
 * Tiers (user decision 2026-07-27): **`view` means you may RUN it.** A
 * view-level holder opens the builder read-only and can still trigger the
 * workflow manually from a record.
 *
 * Instance access gates **user-initiated** work only. Headless execution
 * (schedules, record events, record rules, webhooks, polling, app triggers)
 * runs as the system and reads no member capabilities, so a workflow restricted
 * to `none` still fires — see plan 30 §2.1 and `INSTANCE_SHARE_COPY.workflow`'s
 * `scopeNote`, which states this on every share surface.
 *
 * With no id resolved yet (the editor mounts before the workflow loads) this
 * falls back to the coarse `Area.workflows` rungs. That is not a guess: workflows
 * are `baselineAtCreate: false`, so a workflow with no explicit `ResourceAccess`
 * row resolves to exactly the area level anyway — the fallback and the per-instance
 * answer agree for every unrestricted workflow, and only a restricted one flips
 * once its id arrives.
 *
 * Server enforcement is the source of truth; this is degrade-only, to avoid
 * rendering affordances that 403.
 *
 * MUST be called inside `CapabilitiesProvider` — i.e. only from `(protected)`
 * surfaces. The public `WorkflowViewer` embed has no capability context; that is
 * why {@link import('./use-read-only').useReadOnly} consumes the store flag this
 * hook feeds rather than calling `useAccess()` itself.
 *
 * @param workflowAppId The `WorkflowApp.id`. Falls back to the workflow store.
 */
export function useWorkflowAccess(workflowAppId?: string | null): WorkflowAccess {
  const storeWorkflowAppId = useWorkflowStore((state) => state.workflowAppId)
  const id = workflowAppId ?? storeWorkflowAppId
  const { can, canViewInstance, canEditInstance, canAdminInstance } = useAccess()

  return useMemo(() => {
    const canCreate = can(PermissionKey.workflowsManage)
    if (!id) {
      return {
        canView: can(PermissionKey.workflowsView),
        canEdit: can(PermissionKey.workflowsEdit),
        canAdmin: canCreate,
        canCreate,
      }
    }
    const recordId = toRecordId('workflow', id)
    return {
      canView: canViewInstance(recordId),
      canEdit: canEditInstance(recordId),
      canAdmin: canAdminInstance(recordId),
      canCreate,
    }
  }, [id, can, canViewInstance, canEditInstance, canAdminInstance])
}
