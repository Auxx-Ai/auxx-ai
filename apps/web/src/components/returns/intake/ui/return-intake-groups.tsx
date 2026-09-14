// apps/web/src/components/returns/intake/ui/return-intake-groups.tsx
'use client'

// "3 labels → 2 returns", with the split visible BEFORE the Create button is
// pressed (plans/money/tasks/57 §5.3).
//
// 🛑 The rule this file exists to enforce: grouping happens AFTER confirmation,
// never on the ladder's guesses. §5.3, verbatim:
//
//   "Grouping on unconfirmed matches means a single wrong candidate silently
//    merges two customers' parcels, and the merge is the thing hardest to see
//    and hardest to undo."
//
// So an undecided label is counted, named and shown as undecided — and is in NO
// group. It cannot become a return by inattention, only by a person answering
// the question on its card.
//
// 🛑 Two unidentified pallets are not one return merely because both are
// unidentified (§5.1): that is grouping on the ABSENCE of information. Each
// `confirmedUnidentified` label is its own group, which is why its group id
// carries the label id.

import type { RecordId } from '@auxx/lib/resources/client'
import type {
  ReturnIntakeGroup,
  ReturnIntakeGroupView,
  ReturnIntakeLabel,
} from '@auxx/lib/returns/intake/client'
import { groupLabels } from '@auxx/lib/returns/intake/group'
import { Badge } from '@auxx/ui/components/badge'
import { CircleHelp, Package, PackageSearch, UserRound, UserRoundX } from 'lucide-react'

/**
 * Has this label been answered?
 *
 * 🔑 `confirmedContactRecordId === null` is UNDECIDED. `confirmedUnidentified`
 * is a decision — "not one of ours" — and it still produces a return, with
 * `contact` null and the sender filled from the photo (§4.6). The two must never
 * be collapsed into one falsy check.
 */
export function isLabelDecided(label: ReturnIntakeLabel): boolean {
  return label.confirmedUnidentified || label.confirmedContactRecordId !== null
}

/**
 * The group key is a WIRE FORMAT, and it is `groupLabels`' — not a copy of it.
 *
 * 🛑 `get` does not return groups, so this screen derives them client-side and
 * `commit({ groupIds })` re-derives them server-side from the same labels. A
 * separator or prefix mismatch between the two is not a rendering bug: every
 * group is silently not found and **nothing is created**.
 *
 * An earlier cut of this file reimplemented the derivation here and kept it in
 * sync by hand. That is now deleted. `group.ts` is pure — its only import is a
 * type — so it is published as its own client-safe leaf subpath
 * (`@auxx/lib/returns/intake/group`) rather than through the server barrel,
 * which would pull in Redis and the LLM orchestrator. There is now exactly one
 * definition of the key and it is the one the server uses.
 */
export { groupLabels as buildReturnIntakeGroups }

/** Names for the two relation columns, resolved by the caller. */
export interface ReturnIntakeGroupNames {
  contactNames: Map<RecordId, string>
  orderNumbers: Map<RecordId, string>
}

/** Dress the groups with the names and tracking numbers the summary reads. */
export function buildReturnIntakeGroupViews(
  labels: ReturnIntakeLabel[],
  names: ReturnIntakeGroupNames
): ReturnIntakeGroupView[] {
  const labelsById = new Map(labels.map((label) => [label.id, label]))

  return groupLabels(labels).map((group) => ({
    ...group,
    contactName: group.contactRecordId
      ? (names.contactNames.get(group.contactRecordId) ?? null)
      : null,
    orderNumber: group.orderRecordId ? (names.orderNumbers.get(group.orderRecordId) ?? null) : null,
    trackingNumbers: group.labelIds
      .map((labelId) => labelsById.get(labelId)?.transcription?.trackingNumber ?? null)
      .filter((tracking): tracking is string => tracking !== null && tracking.trim() !== ''),
  }))
}

interface ReturnIntakeGroupsProps {
  labels: ReturnIntakeLabel[]
  groups: ReturnIntakeGroupView[]
  /** Groups already committed in this session — shown as done, not as pending. */
  committedGroupIds?: ReadonlySet<string>
}

/**
 * The summary. One line of arithmetic, then the split it stands for.
 *
 * 🛑 The undecided count is not hidden when it is zero-versus-nonzero styling:
 * a label nobody answered is the one thing on this screen that silently changes
 * what Create does, so it gets its own row with its own words.
 */
export function ReturnIntakeGroups({ labels, groups, committedGroupIds }: ReturnIntakeGroupsProps) {
  const undecided = labels.filter((label) => !isLabelDecided(label))
  const groupedLabelCount = groups.reduce((sum, group) => sum + group.labelIds.length, 0)

  return (
    <div className='flex flex-col gap-3 rounded-2xl border p-3' data-testid='return-intake-groups'>
      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
        <span className='font-medium text-sm' data-testid='group-summary'>
          {groupedLabelCount} {groupedLabelCount === 1 ? 'label' : 'labels'} &rarr; {groups.length}{' '}
          {groups.length === 1 ? 'return' : 'returns'}
        </span>
        {undecided.length > 0 && (
          <span className='text-muted-foreground text-xs' data-testid='undecided-count'>
            {undecided.length} still undecided, and not in any return
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <p className='flex items-start gap-1.5 text-muted-foreground text-xs'>
          <CircleHelp className='mt-0.5 size-3.5 shrink-0' />
          <span>
            Nothing is grouped yet. Answer &quot;who sent it&quot; on each label above — the returns
            below follow from the answers, never from the suggestions.
          </span>
        </p>
      ) : (
        <ul className='flex flex-col gap-1.5'>
          {groups.map((group) => {
            const committed = committedGroupIds?.has(group.id) ?? false
            return (
              <li
                key={group.id}
                data-testid={`group-${group.id}`}
                className='flex flex-wrap items-center gap-2 rounded-xl bg-primary-50 px-2.5 py-2 text-sm'>
                {group.contactRecordId === null ? (
                  <UserRoundX className='size-4 shrink-0 text-muted-foreground' />
                ) : (
                  <UserRound className='size-4 shrink-0 text-muted-foreground' />
                )}
                <span className='min-w-0 truncate'>
                  {group.contactRecordId === null
                    ? 'Unidentified sender'
                    : (group.contactName ?? 'Selected customer')}
                </span>

                {group.orderRecordId ? (
                  <Badge variant='gray' size='xs'>
                    <Package className='size-3' />
                    {group.orderNumber ?? 'Order'}
                  </Badge>
                ) : (
                  <Badge variant='outline' size='xs'>
                    No order
                  </Badge>
                )}

                <Badge variant='outline' size='xs'>
                  {group.labelIds.length} {group.labelIds.length === 1 ? 'parcel' : 'parcels'}
                </Badge>

                {group.trackingNumbers.length > 0 && (
                  <span className='min-w-0 truncate font-mono text-muted-foreground text-xs'>
                    {group.trackingNumbers.join(' · ')}
                  </span>
                )}

                {committed && (
                  <Badge variant='green' size='xs' className='ms-auto'>
                    Created
                  </Badge>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {undecided.length > 0 && (
        <ul className='flex flex-col gap-1' data-testid='undecided-list'>
          {undecided.map((label) => (
            <li
              key={label.id}
              data-testid={`undecided-${label.id}`}
              className='flex items-center gap-2 px-2.5 text-muted-foreground text-xs'>
              <PackageSearch className='size-3.5 shrink-0' />
              <span className='min-w-0 truncate'>
                {label.fileName} &mdash; nobody has said whose this is, so it creates nothing
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
