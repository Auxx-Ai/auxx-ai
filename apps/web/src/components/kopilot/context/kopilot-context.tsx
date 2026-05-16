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

  activeKnowledgeBaseId?: string
  activeKnowledgeBaseLabel?: string

  activeArticleId?: string
  activeArticleLabel?: string

  activeAgentId?: string
  activeAgentLabel?: string
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
    activeKnowledgeBaseId,
    activeKnowledgeBaseLabel,
    activeArticleId,
    activeArticleLabel,
    activeAgentId,
    activeAgentLabel,
  } = props

  useEffect(() => {
    const references: SessionRef[] = []
    pushSurfaceRef(references, 'thread', activeThreadId, activeThreadLabel)
    // Contacts are records — the recordId prefix tells the agent it's a contact.
    pushSurfaceRef(references, 'record', activeContactId, activeContactLabel)
    pushSurfaceRef(references, 'record', activeRecordId, activeRecordLabel)
    pushSurfaceRef(references, 'kb', activeKnowledgeBaseId, activeKnowledgeBaseLabel)
    pushSurfaceRef(references, 'article', activeArticleId, activeArticleLabel)
    // Agent surface chips are pinned — the agent IS the subject of the
    // conversation (builder, future agent-detail surfaces). Letting the
    // admin dismiss it leaves the LLM context ambiguous about which
    // agent is being acted on.
    pushSurfaceRef(references, 'agent', activeAgentId, activeAgentLabel, { pinned: true })

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
    activeKnowledgeBaseId,
    activeKnowledgeBaseLabel,
    activeArticleId,
    activeArticleLabel,
    activeAgentId,
    activeAgentLabel,
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
  opts: { pinned?: boolean } = {}
): void {
  if (id === undefined || id === '') return
  refs.push({
    kind,
    id,
    ...(label ? { label } : {}),
    origin: 'surface',
    ...(opts.pinned ? { pinned: true } : {}),
  })
}
