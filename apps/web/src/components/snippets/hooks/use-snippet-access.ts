// apps/web/src/components/snippets/hooks/use-snippet-access.ts
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'

/** The three per-snippet rungs plus the coarse instance-less `snippets.manage` gate. */
export interface SnippetAccess {
  /** `view` — read the snippet and insert it. */
  canView: boolean
  /** `edit` — title, body, description, folder, favourite. */
  canEdit: boolean
  /** `admin` — share and delete. */
  canAdmin: boolean
  /**
   * Coarse `snippets.manage`. Fronts the two actions that have no instance to
   * key on: **creating** a snippet, and **folder** create/rename/delete —
   * folders stay flat labels with no per-folder grants (plan 36 decision 0.4),
   * so `snippet.createFolder` / `updateFolder` / `deleteFolder` all assert this
   * exact key server-side. An affordance rendered without it 403s on click.
   */
  canManage: boolean
}

/**
 * Per-snippet instance access for the client (plan 36 §8) — the snippet twin of
 * {@link import('~/components/agents/hooks/use-agent-access').useAgentAccess},
 * keyed by `Snippet.id`.
 *
 * Unlike agents, snippets are **`baselineAtCreate: true`**: a snippet with no
 * explicit `ResourceAccess` row grants NOTHING, so there is no meaningful area
 * fallback for an unresolved id. With no id, only `canManage` is answerable and
 * the three instance rungs report `false` — a caller that has an id must pass
 * it, and one that does not has no instance to authorize against anyway.
 *
 * Server enforcement is the source of truth
 * (`~/server/lib/snippet-instance-access.ts`); this is degrade-only, to avoid
 * rendering affordances that 403.
 *
 * MUST be called inside `CapabilitiesProvider` — i.e. only from `(protected)`
 * surfaces.
 *
 * @param snippetId The `Snippet.id`. Pass `null`/`undefined` while creating.
 */
export function useSnippetAccess(snippetId?: string | null): SnippetAccess {
  const { can, canViewInstance, canEditInstance, canAdminInstance } = useAccess()

  return useMemo(() => {
    const canManage = can(PermissionKey.snippetsManage)
    if (!snippetId) {
      return { canView: false, canEdit: false, canAdmin: false, canManage }
    }
    const recordId = toRecordId('snippet', snippetId)
    return {
      canView: canViewInstance(recordId),
      canEdit: canEditInstance(recordId),
      canAdmin: canAdminInstance(recordId),
      canManage,
    }
  }, [snippetId, can, canViewInstance, canEditInstance, canAdminInstance])
}
