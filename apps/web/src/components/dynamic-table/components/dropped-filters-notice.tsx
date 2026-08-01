// apps/web/src/components/dynamic-table/components/dropped-filters-notice.tsx
'use client'

import type { DroppedFilterNotice, ResourceField } from '@auxx/lib/resources/client'
import { isResourceFieldId, parseResourceFieldId } from '@auxx/types/field'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { FunnelX } from 'lucide-react'

/**
 * Human sentence per drop reason. Deliberately vague about the *mechanism* —
 * there is nothing the user can do about a cuid-vs-registry-key mismatch, and
 * the actionable half ("this list is showing more than you asked for") is the
 * same either way.
 */
const REASON_TEXT: Record<DroppedFilterNotice['reason'], string> = {
  'unresolved-field-or-operator': 'this field or operator could not be applied',
  'unresolved-value-source': 'its value could not be resolved',
}

interface DroppedFiltersNoticeProps {
  /** Server-capped list of conditions that produced no SQL. */
  droppedConditions: DroppedFilterNotice[]
  /** Uncapped total — may exceed `droppedConditions.length`. */
  droppedConditionCount: number
  /** Resource fields, used to turn a field id into the label the user picked. */
  fields?: ResourceField[]
}

/**
 * Quiet footer affordance: "1 filter ignored".
 *
 * Exists because the list query **fails open** — a filter condition the builder
 * cannot compile is dropped and the query runs anyway, so the list silently
 * widens. That is the right behaviour for saved views and stored dashboard
 * widgets (a view naming a retired field must still render), but it made a whole
 * class of bugs invisible: KB free-text search matching everything, the KB
 * Tag/Status/Kind filters matching everything, dashboard thread widgets returning
 * org-wide lists. Every one of those was found by accident.
 *
 * It is **not** an error state and there is nothing for the user to fix, so this
 * is a muted inline label with the detail on hover — not a banner, not a toast,
 * and not a modal. Rendering nothing when the list is clean is the common case.
 */
export function DroppedFiltersNotice({
  droppedConditions,
  droppedConditionCount,
  fields,
}: DroppedFiltersNoticeProps) {
  // Silence is the overwhelmingly common case, and it is load-bearing: this
  // mounts under every records table on every render.
  if (!droppedConditionCount) return null

  const label = (ref: string | string[]): string => {
    // Relationship paths arrive as a hop array; the last hop is the field the
    // user actually chose, which is the one worth naming.
    const leaf = Array.isArray(ref) ? (ref[ref.length - 1] ?? '') : ref
    // A cuid falls through as itself — which is exactly the visible symptom of
    // the tracked cuid-vs-registry-key resolution bug on the KB filters, and is
    // still more useful than saying nothing.
    const fieldId = isResourceFieldId(leaf) ? parseResourceFieldId(leaf).fieldId : leaf
    const field = fields?.find((f) => f.id === fieldId || f.key === fieldId)
    return field?.name || field?.label || fieldId || 'Unknown field'
  }

  return (
    <SimpleTooltip
      side='top'
      contentComponent={
        <div className='max-w-xs space-y-1'>
          <p className='font-medium'>This list is showing more than your filters ask for.</p>
          <ul className='space-y-0.5'>
            {droppedConditions.map((d) => (
              <li key={d.conditionId}>
                <span className='font-medium'>{label(d.fieldRef)}</span> {d.operator} — was not
                applied because {REASON_TEXT[d.reason]}.
              </li>
            ))}
          </ul>
          {droppedConditionCount > droppedConditions.length && (
            <p>and {droppedConditionCount - droppedConditions.length} more.</p>
          )}
        </div>
      }>
      <span className='ml-2 inline-flex cursor-default items-center gap-1 text-muted-foreground'>
        <FunnelX className='size-3.5' />
        {droppedConditionCount === 1
          ? '1 filter was ignored'
          : `${droppedConditionCount} filters were ignored`}
      </span>
    </SimpleTooltip>
  )
}
