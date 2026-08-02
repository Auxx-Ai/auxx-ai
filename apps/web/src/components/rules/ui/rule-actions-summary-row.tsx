// apps/web/src/components/rules/ui/rule-actions-summary-row.tsx

'use client'

import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Zap } from 'lucide-react'

interface RuleActionsSummaryRowProps {
  /** Display labels of the configured actions, in evaluation order. */
  labels: string[]
  /** Drill into the actions page. */
  onOpen: () => void
  /** Secondary line when nothing is configured yet. */
  emptyText?: string
}

/**
 * The bridge from a rule's definition page to its actions page: a single
 * drill-in {@link TreeRow} summarising what is configured.
 *
 * It replaces the old "Continue" footer button. That button conflated two
 * different things — "this step is done" and "go to the next step" — which made
 * the definition page feel like a wizard the user had to finish before anything
 * could be saved. With the drill row, navigation is a thing on the page and the
 * footer button means exactly one thing: Save.
 *
 * Shared by record rules and mail filters so the two dialogs keep the same
 * shape (§6.1).
 */
export function RuleActionsSummaryRow({
  labels,
  onOpen,
  emptyText = 'No actions yet. Add at least one before saving',
}: RuleActionsSummaryRowProps) {
  const hasActions = labels.length > 0

  return (
    <Section title='Actions' icon={<Zap className='size-4' />} collapsible={false}>
      <TreeRow
        icon={<Zap className='size-4' />}
        title={<span className='text-sm'>Set actions</span>}
        secondary={
          <span className='text-xs text-muted-foreground'>
            {hasActions ? labels.join(' · ') : emptyText}
          </span>
        }
        secondaryFill
        onDrill={onOpen}
        rowClassName='bg-primary-50 hover:bg-primary-100'
      />
    </Section>
  )
}
