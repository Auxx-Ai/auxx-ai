// apps/web/src/components/record-rules/ui/record-rule-runs-dialog.tsx

'use client'

import { RuleRunsDialog } from '~/components/rules/ui/rule-runs-dialog'
import { api } from '~/trpc/react'
import type { EditableRecordRule } from './record-rule-dialog'

interface RecordRuleRunsDialogProps {
  rule: EditableRecordRule
  open: boolean
  onClose: () => void
}

/** Recent firings of one record rule with per-action outcomes — the debugging view. */
export function RecordRuleRunsDialog({ rule, open, onClose }: RecordRuleRunsDialogProps) {
  const { data: runs, isLoading } = api.recordRules.runs.useQuery(
    { ruleId: rule.id },
    { enabled: open }
  )

  return (
    <RuleRunsDialog
      open={open}
      onClose={onClose}
      name={rule.name}
      runs={runs}
      isLoading={isLoading}
      emptyText='This rule has not fired yet.'
      // The trigger context — which field changed, and from what to what.
      renderExtraColumns={(run) =>
        run.fieldId ? (
          <p className='mt-1 text-muted-foreground'>
            {JSON.stringify(run.oldValue)} → {JSON.stringify(run.newValue)}
          </p>
        ) : null
      }
    />
  )
}
