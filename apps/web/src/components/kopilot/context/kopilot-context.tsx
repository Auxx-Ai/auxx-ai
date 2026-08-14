// apps/web/src/components/kopilot/context/kopilot-context.tsx

'use client'

import { useEffect, useId } from 'react'
import { useKopilotStore } from '../stores/kopilot-store'
import type { ContextSlice, SessionRef, SessionRefKind } from './types'

interface KopilotContextProps {
  /** Top-level page identifier — set on the page root only. Never produces a chip. */
  page?: string

  activeThreadId?: string
  activeThreadLabel?: string

  activeContactId?: string
  activeContactLabel?: string

  activeRecordId?: string
  activeRecordLabel?: string

  /** Entity TYPE the user is viewing (records table page). id = entityDefinitionId. */
  activeResourceId?: string
  activeResourceLabel?: string

  activeKnowledgeBaseId?: string
  activeKnowledgeBaseLabel?: string

  activeArticleId?: string
  activeArticleLabel?: string

  activeAgentId?: string
  activeAgentLabel?: string

  /** WorkflowApp id open in the workflow builder. */
  activeWorkflowId?: string
  activeWorkflowLabel?: string
  /**
   * Advisory: the open canvas has unsaved changes (`workflow-store.isDirty`).
   * Rides the `workflow` ref so graph mutations refuse against a stale draft.
   */
  activeWorkflowIsDirty?: boolean
}

/**
 * Distributed page-context contributor. Mount one (or many) on a page; each
 * mount registers a slice while alive and unregisters on unmount.
 *
 * Props are primitives so React's default dep-comparison drives effect re-runs;
 * no `useMemo` required at the call site.
 *
 * Each non-empty `active*Id` becomes a `SessionRef` with `origin: 'surface'`.
 * The kind set is intentionally narrow — see `SessionRefKind` in
 * `@auxx/lib/ai/kopilot/types`. Surfaces that today don't ship a caller
 * (meeting / call recording / transcript-selection / filters) come back as
 * new kinds when a real call site emits one.
 */
export function KopilotContext(props: KopilotContextProps): null {
  const id = useId()
  const setSlice = useKopilotStore((s) => s.setContextSlice)
  const clearSlice = useKopilotStore((s) => s.clearContextSlice)

  const {
    page,
    activeThreadId,
    activeThreadLabel,
    activeContactId,
    activeContactLabel,
    activeRecordId,
    activeRecordLabel,
    activeResourceId,
    activeResourceLabel,
    activeKnowledgeBaseId,
    activeKnowledgeBaseLabel,
    activeArticleId,
    activeArticleLabel,
    activeAgentId,
    activeAgentLabel,
    activeWorkflowId,
    activeWorkflowLabel,
    activeWorkflowIsDirty,
  } = props

  useEffect(() => {
    const references: SessionRef[] = []
    pushSurfaceRef(references, 'thread', activeThreadId, activeThreadLabel)
    // Contacts are records — the recordId prefix tells the agent it's a contact.
    pushSurfaceRef(references, 'record', activeContactId, activeContactLabel)
    pushSurfaceRef(references, 'record', activeRecordId, activeRecordLabel)
    // The entity type whose table the user is viewing — drives records-page view tools.
    pushSurfaceRef(references, 'resource', activeResourceId, activeResourceLabel)
    pushSurfaceRef(references, 'kb', activeKnowledgeBaseId, activeKnowledgeBaseLabel)
    pushSurfaceRef(references, 'article', activeArticleId, activeArticleLabel)
    // Agent surface chips are pinned — the agent IS the subject of the
    // conversation (builder, future agent-detail surfaces). Letting the
    // admin dismiss it leaves the LLM context ambiguous about which
    // agent is being acted on.
    pushSurfaceRef(references, 'agent', activeAgentId, activeAgentLabel, { pinned: true })
    // Workflow chips are pinned for the same reason agent chips are: the
    // workflow IS the subject of every builder tool, and dismissing it would
    // leave the graph tools with no target (`NO_WORKFLOW_REF_ERROR`).
    pushSurfaceRef(references, 'workflow', activeWorkflowId, activeWorkflowLabel, {
      pinned: true,
      isDirty: activeWorkflowIsDirty,
    })

    const slice: ContextSlice = { references, ...(page !== undefined ? { page } : {}) }
    setSlice(id, slice)
    return () => clearSlice(id)
  }, [
    id,
    page,
    activeThreadId,
    activeThreadLabel,
    activeContactId,
    activeContactLabel,
    activeRecordId,
    activeRecordLabel,
    activeResourceId,
    activeResourceLabel,
    activeKnowledgeBaseId,
    activeKnowledgeBaseLabel,
    activeArticleId,
    activeArticleLabel,
    activeAgentId,
    activeAgentLabel,
    activeWorkflowId,
    activeWorkflowLabel,
    activeWorkflowIsDirty,
    setSlice,
    clearSlice,
  ])

  return null
}

function pushSurfaceRef(
  refs: SessionRef[],
  kind: SessionRefKind,
  id: string | undefined,
  label: string | undefined,
  opts: { pinned?: boolean; isDirty?: boolean } = {}
): void {
  if (id === undefined || id === '') return
  refs.push({
    kind,
    id,
    ...(label ? { label } : {}),
    origin: 'surface',
    ...(opts.isDirty !== undefined ? { isDirty: opts.isDirty } : {}),
    ...(opts.pinned ? { pinned: true } : {}),
  })
}
