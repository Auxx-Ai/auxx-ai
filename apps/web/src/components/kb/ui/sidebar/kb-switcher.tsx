// apps/web/src/components/kb/ui/sidebar/kb-switcher.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Book } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { EntityBreadcrumbSwitcher } from '~/components/pickers/entity-breadcrumb-switcher'
import type { EntitySwitcherItem } from '~/components/pickers/entity-switcher-list'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useKnowledgeBaseMutations } from '../../hooks/use-knowledge-base-mutations'
import { useKnowledgeBases } from '../../hooks/use-knowledge-bases'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import {
  KnowledgeBaseDialog,
  type KnowledgeBaseFormValues,
} from '../dialogs/kb-knowledge-base-dialog'

function getInitials(name?: string): string {
  if (!name) return 'KB'
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)
}

/** Public / Unlisted / Private, matching the KB's live publish state. */
function publishStatusBadge(publishStatus: KnowledgeBase['publishStatus']) {
  if (publishStatus === 'PUBLISHED')
    return (
      <Badge variant='green' size='xs'>
        Public
      </Badge>
    )
  if (publishStatus === 'UNLISTED')
    return (
      <Badge variant='amber' size='xs'>
        Unlisted
      </Badge>
    )
  return (
    <Badge variant='gray' size='xs'>
      Private
    </Badge>
  )
}

interface KBBreadcrumbSwitcherProps {
  /**
   * The knowledge base currently open, already merged with its settings draft.
   * Omit on the landing page — with no active KB no row renders a check and the
   * trigger falls back to "Open a knowledge base".
   */
  activeKnowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
}

/**
 * Breadcrumb switcher for knowledge bases — every KB the viewer can see, its
 * publish status, a favorite star, and per-row delete for the ones the viewer
 * administers, plus an "Add Knowledge Base" footer row when the plan and the
 * `knowledgeBaseManage` key both allow it.
 *
 * Navigation preserves the current `?panel=` so switching KBs from the editor
 * keeps you on the same settings panel.
 */
export function KBBreadcrumbSwitcher({ activeKnowledgeBase }: KBBreadcrumbSwitcherProps) {
  const router = useRouter()
  const params = useSearchParams()
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const { knowledgeBases, isLoading } = useKnowledgeBases()
  const { createKnowledgeBase, isCreating, deleteKnowledgeBase } = useKnowledgeBaseMutations()

  const { getLimit } = useFeatureFlags()
  const kbLimit = getLimit(FeatureKey.knowledgeBases)
  // Mirrors the server: `kb.create` asserts the L2 area key AND the plan limit,
  // `kb.delete` asserts `assertAdminInstance` per KB. Degrade-only — the router
  // is still the enforcement point.
  const { can, canAdminInstance } = useAccess()
  const canManageKBs = can(PermissionKey.knowledgeBaseManage)

  const canCreateKB = useMemo(() => {
    if (!canManageKBs) return false
    if (kbLimit === null || kbLimit === false || kbLimit === 0) return false
    if (kbLimit === '+' || kbLimit === true) return true
    if (typeof kbLimit === 'number') return knowledgeBases.length < kbLimit
    return true
  }, [canManageKBs, kbLimit, knowledgeBases.length])

  const items = useMemo<EntitySwitcherItem[]>(
    () =>
      knowledgeBases.map((kb) => {
        const merged = mergeDraftOverLive(kb as Record<string, unknown>) as KnowledgeBase
        return {
          id: kb.id,
          label: merged.name ?? 'Untitled knowledge base',
          icon: <Book className='size-3' />,
          secondary: publishStatusBadge(merged.publishStatus),
        }
      }),
    [knowledgeBases]
  )

  // The list is the source of truth for renames (it carries optimistic updates);
  // the prop only covers the window before the list has loaded.
  const activeLabel =
    items.find((item) => item.id === activeKnowledgeBase?.id)?.label ??
    activeKnowledgeBase?.name ??
    (activeKnowledgeBase ? 'Knowledge Base' : 'Open a knowledge base')

  const goToKnowledgeBase = (knowledgeBaseId: string) => {
    const panel = params?.get('panel') ?? 'general'
    router.push(`/app/kb/${knowledgeBaseId}/editor?panel=${panel}`)
  }

  const handleCreateSubmit = async (values: KnowledgeBaseFormValues) => {
    const created = await createKnowledgeBase({
      name: values.name,
      slug: values.slug,
    })
    if (created) {
      setShowCreateDialog(false)
      router.push(`/app/kb/${created.id}/editor`)
    }
  }

  const handleDelete = async (item: EntitySwitcherItem) => {
    const success = await deleteKnowledgeBase(item.id)
    if (success && item.id === activeKnowledgeBase?.id) {
      const next = knowledgeBases.find((kb) => kb.id !== item.id)
      router.push(next ? `/app/kb/${next.id}/editor` : '/app/kb')
    }
  }

  return (
    <>
      <KnowledgeBaseDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={handleCreateSubmit}
        isSubmitting={isCreating}
        mode='create'
      />

      <EntityBreadcrumbSwitcher<'KNOWLEDGE_BASE'>
        activeLabel={activeLabel}
        activeIcon={
          activeKnowledgeBase ? (
            <Avatar className='size-5 rounded'>
              <AvatarFallback className='rounded bg-primary/10 text-[10px] text-primary'>
                {getInitials(activeLabel)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Book className='size-3.5' />
          )
        }
        items={items}
        activeId={activeKnowledgeBase?.id}
        isLoading={isLoading}
        onSelect={(item) => goToKnowledgeBase(item.id)}
        onDelete={handleDelete}
        canDelete={(item) => canAdminInstance(toRecordId('kb', item.id))}
        deleteConfirm={(item) => ({
          title: 'Delete knowledge base?',
          description: `"${item.label}" and all of its docs will be permanently deleted. This action cannot be undone.`,
        })}
        favorite={{
          targetType: 'KNOWLEDGE_BASE',
          targetIds: (item) => ({ knowledgeBaseId: item.id }),
        }}
        onCreate={canCreateKB ? () => setShowCreateDialog(true) : undefined}
        createLabel='Add Knowledge Base'
        searchPlaceholder='Search knowledge bases...'
        emptyText='No knowledge bases found'
      />
    </>
  )
}
