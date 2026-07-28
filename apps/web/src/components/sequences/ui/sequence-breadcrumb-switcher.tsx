// apps/web/src/components/sequences/ui/sequence-breadcrumb-switcher.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { Pencil, SendHorizonal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useMemo } from 'react'
import { EntityBreadcrumbSwitcher, type EntitySwitcherItem } from '~/components/pickers'
import { api, type RouterOutputs } from '~/trpc/react'

/** A sequence row as returned by `sequence.list`. */
type SequenceRow = RouterOutputs['sequence']['list'][number]

/** Where the sequences tab of `/app/workflows` lives — the post-delete landing. */
const SEQUENCES_HREF = '/app/workflows?t=sequences'

interface SequenceBreadcrumbSwitcherProps {
  /** The sequence currently open — highlighted in the list. */
  activeSequenceId: string
  /** Trigger label — the active sequence's name. */
  activeLabel: React.ReactNode
}

/**
 * Publish-state badge, the same pair the detail header renders: a sequence is
 * either an unpublished Draft or a published one with pending edits.
 */
function publishBadge(sequence: SequenceRow) {
  if (!sequence.publishedAt)
    return (
      <Badge variant='gray' size='xs'>
        Draft
      </Badge>
    )
  if (sequence.hasUnpublishedChanges)
    return (
      <Badge variant='amber' size='xs'>
        <Pencil />
        Unpublished changes
      </Badge>
    )
  return null
}

/**
 * The sequence switcher mounted in the sequence detail breadcrumb — search,
 * jump, and delete across every sequence the member may view.
 *
 * Deliberately separate from {@link import('~/components/workflow/ui/workflow-breadcrumb-switcher')
 * .WorkflowBreadcrumbSwitcher} even though sequences nest under the Workflows
 * crumb: a sequence is not a workflow and the row actions differ.
 *
 * `sequence` is not an instance-access resource, so there is no per-row
 * capability to consult — delete matches `SequenceCard`, which offers it on
 * every non-template sequence and lets the router's own `ResourceAccess` check
 * be the authority.
 */
export function SequenceBreadcrumbSwitcher({
  activeSequenceId,
  activeLabel,
}: SequenceBreadcrumbSwitcherProps) {
  const router = useRouter()
  const utils = api.useUtils()

  const { data, isLoading } = api.sequence.list.useQuery(undefined, { staleTime: 30_000 })

  const deleteSequence = api.sequence.delete.useMutation({
    onSuccess: () => void utils.sequence.list.invalidate(),
    onError: (error) =>
      toastError({ title: 'Failed to delete sequence', description: error.message }),
  })

  const rows = useMemo(() => data ?? [], [data])
  const templateKeyById = useMemo(
    () => new Map(rows.map((row) => [row.id, row.templateKey])),
    [rows]
  )

  const items = useMemo<EntitySwitcherItem[]>(
    () =>
      rows.map((sequence) => ({
        id: sequence.id,
        label: sequence.name,
        href: `/app/workflows/sequences/${sequence.id}`,
        icon: <SendHorizonal className='size-3.5' />,
        secondary: publishBadge(sequence),
      })),
    [rows]
  )

  return (
    <EntityBreadcrumbSwitcher
      activeLabel={activeLabel}
      items={items}
      activeId={activeSequenceId}
      isLoading={isLoading}
      searchPlaceholder='Search sequences...'
      emptyText='No sequences'
      onSelect={(item) => router.push(item.href ?? SEQUENCES_HREF)}
      canDelete={(item) => !templateKeyById.get(item.id)}
      deleteConfirm={() => ({
        title: 'Delete sequence?',
        description:
          'This deletes the sequence and its steps. Sequences with active runs cannot be deleted until those runs exit.',
      })}
      onDelete={async (item) => {
        await deleteSequence.mutateAsync({ id: item.id })
        if (item.id === activeSequenceId) router.push(SEQUENCES_HREF)
      }}
    />
  )
}
