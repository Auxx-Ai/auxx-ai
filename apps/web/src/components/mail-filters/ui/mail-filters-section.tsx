// apps/web/src/components/mail-filters/ui/mail-filters-section.tsx

'use client'

import { describeMailFilter, type MailFilterRow } from '@auxx/lib/mail-filters/client'
import type { ListCardBadgeChip, ListCardMenuItem } from '@auxx/ui/components/list-card'
import { formatDistanceToNow } from 'date-fns'
import { ArrowDown, ArrowUp, Filter } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type RuleListGroup, RuleListSection } from '~/components/rules/ui/rule-list-section'
import { api } from '~/trpc/react'
import type { AuthorableInboxOption } from '../hooks/use-mail-filter-lookups'
import { useMailFilterLookups } from '../hooks/use-mail-filter-lookups'
import { useMailFilters } from '../hooks/use-mail-filters'
import { BlockedSendersCard } from './blocked-senders-card'
import { MailFilterDialog } from './mail-filter-dialog'
import { MailFilterRunsDialog } from './mail-filter-runs-dialog'

/**
 * Mail filters settings section — the shared rule card grid wired to
 * `api.mailFilters`, **grouped by inbox** (§6.3).
 *
 * The grouping is not cosmetic: `order` is per-inbox, so "Move up" in a flat
 * mixed grid would be meaningless. Each card therefore carries its position as a
 * leading badge and reorders through menu items that rewrite ONE inbox's
 * ordering.
 *
 * §6.4 — **this section self-scopes.** It renders exactly the inboxes
 * `api.mailFilters.authorableInboxes` returns (the same computation the router
 * scopes `list` with, §5.1) and hides itself entirely when that set is empty, so
 * an automation admin with no inbox write sees nothing here and a personal
 * mailbox owner with no permission key sees only their own mailbox. The page is
 * a mount point; the router is the gate (invariant 11).
 *
 * D13 — user-facing copy says "Filters"; code, routes and vocabulary stay
 * `mailFilter` / `mailFilters` throughout.
 */
export function MailFiltersSection() {
  const { data: authorableInboxes } = api.mailFilters.authorableInboxes.useQuery()

  // §6.4 — the section is INVISIBLE, not empty, when the caller may author on no
  // inbox at all. Split in two so the guard sits above every other hook: an
  // empty authorable set means none of the filter, tag, actor or channel queries
  // below are ever issued, and the member never sees a card grid advertising a
  // feature they cannot use.
  if (!authorableInboxes || authorableInboxes.length === 0) return null
  return <MailFiltersSectionBody inboxRows={authorableInboxes} />
}

function MailFiltersSectionBody({ inboxRows }: { inboxRows: AuthorableInboxOption[] }) {
  const { list, setEnabled, reorder, destroy } = useMailFilters()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<MailFilterRow | null>(null)
  const [runsFor, setRunsFor] = useState<MailFilterRow | null>(null)

  const filters = useMemo(() => list.data ?? [], [list.data])
  const { resolveName } = useMailFilterLookups(inboxRows)

  /** One group per authorable inbox, each ordered by its own `order`. */
  const groups = useMemo<RuleListGroup<MailFilterRow>[]>(
    () =>
      inboxRows.map((inbox) => ({
        key: inbox.id,
        label: inbox.isPersonal ? `${inbox.name} · your mailbox` : inbox.name,
        rows: filters
          .filter((filter) => filter.inboxId === inbox.id)
          .sort((a, b) => a.order - b.order),
      })),
    [inboxRows, filters]
  )

  /** filterId → { inboxId, index, siblings } for the Move up/Move down items. */
  const positions = useMemo(() => {
    const map = new Map<string, { inboxId: string; index: number; siblingIds: string[] }>()
    for (const group of groups) {
      const siblingIds = group.rows.map((row) => row.id)
      group.rows.forEach((row, index) => {
        map.set(row.id, { inboxId: group.key, index, siblingIds })
      })
    }
    return map
  }, [groups])

  /**
   * Swap one filter with its neighbour and send the WHOLE inbox's id list.
   *
   * The lib mutation requires the complete list on purpose — a partial rewrite
   * leaves colliding `order` values, and colliding orders make `stopProcessing`
   * arbitrary (which filter "came first" stops being defined).
   */
  const move = (filter: MailFilterRow, delta: -1 | 1) => {
    const position = positions.get(filter.id)
    if (!position) return
    const target = position.index + delta
    if (target < 0 || target >= position.siblingIds.length) return

    const orderedFilterIds = [...position.siblingIds]
    const [moved] = orderedFilterIds.splice(position.index, 1)
    if (!moved) return
    orderedFilterIds.splice(target, 0, moved)
    reorder.mutate({ inboxId: position.inboxId, orderedFilterIds })
  }

  return (
    <RuleListSection
      icon={Filter}
      title='Mail filters'
      description='When a new message arrives in an inbox, check conditions and act on the conversation.'
      createLabel='Add'
      onCreate={() => setCreateOpen(true)}
      isLoading={list.isLoading}
      groups={groups}
      leadingBadge={(filter) => (
        <span className='inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-primary-200 text-[10px] font-medium text-foreground ring-1 ring-input'>
          {filter.order + 1}
        </span>
      )}
      subtitle={(filter) =>
        filter.lastFiredAt
          ? `Last fired ${formatDistanceToNow(filter.lastFiredAt, { addSuffix: true })}`
          : 'Never fired'
      }
      describe={(filter) => describeMailFilter(filter, resolveName)}
      badges={(filter): ListCardBadgeChip[] => [
        ...(filter.templateKey ? [{ label: 'Suggested' }] : []),
        ...(filter.stopProcessing ? [{ label: 'Stops here' }] : []),
        ...(filter.enabled ? [] : [{ label: 'Disabled' }]),
      ]}
      extraMenuItems={(filter): ListCardMenuItem[] => {
        const position = positions.get(filter.id)
        return [
          {
            label: 'Move up',
            icon: <ArrowUp />,
            onClick: () => move(filter, -1),
            disabled: !position || position.index === 0,
          },
          {
            label: 'Move down',
            icon: <ArrowDown />,
            onClick: () => move(filter, 1),
            disabled: !position || position.index >= position.siblingIds.length - 1,
          },
        ]
      }}
      onEdit={setEditing}
      onViewRuns={setRunsFor}
      onToggleEnabled={(filter) =>
        setEnabled.mutate({ filterId: filter.id, enabled: !filter.enabled })
      }
      onDelete={(filter) => destroy.mutate({ filterId: filter.id })}
      deleteConfirmTitle='Delete filter?'
      placeholder={{
        title: 'Add a filter',
        subtitle: 'Mail filters',
        description: 'Sort new mail automatically as it arrives.',
      }}>
      <BlockedSendersCard inboxIds={inboxRows.map((inbox) => inbox.id)} />

      <MailFilterDialog
        open={createOpen || editing !== null}
        onClose={() => {
          setCreateOpen(false)
          setEditing(null)
        }}
        filter={editing}
        inboxes={inboxRows}
        filters={filters}
        // A single authorable inbox is the overwhelmingly common case (a member
        // filtering their own mailbox) — preselect it rather than making them
        // choose from a list of one.
        defaultInboxId={inboxRows.length === 1 ? inboxRows[0]?.id : undefined}
      />
      {runsFor && <MailFilterRunsDialog filter={runsFor} open onClose={() => setRunsFor(null)} />}
    </RuleListSection>
  )
}
