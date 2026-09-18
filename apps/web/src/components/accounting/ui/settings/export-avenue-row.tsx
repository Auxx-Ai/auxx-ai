// apps/web/src/components/accounting/ui/settings/export-avenue-row.tsx
'use client'

// The Posting page's per-avenue export row (TARGET §3, §4 gate 2): autoPost,
// autoSend and, where the avenue has one, summaryGrain, together on one row
// rather than three stacked `SettingsFieldRow`s - see `posting-page-model.ts`
// for why this is keyed on the AVENUE rather than on the policy's own type.

import type { SummaryGrain } from '@auxx/lib/accounting/ledger/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { FieldPanelRow } from '~/components/global/forms/field-panel'

interface ToggleControl {
  checked: boolean
  onChange: (checked: boolean) => void
}

interface GrainControl {
  value: SummaryGrain
  onChange: (value: SummaryGrain) => void
}

interface ExportAvenueRowProps {
  /** Absent for the three avenues with no draft step (payout, bankDeposit, journal). */
  autoPost?: ToggleControl
  autoSend: ToggleControl
  /** Absent for the avenues TARGET §3 says are inherently one object each. */
  summaryGrain?: GrainControl
}

/** One switch, labeled underneath rather than beside it - three fit on a row this way. */
function LabeledSwitch({
  label,
  hint,
  control,
}: {
  label: string
  hint: string
  control: ToggleControl
}) {
  return (
    <label className='flex flex-col items-start gap-1' title={hint}>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <Switch size='sm' checked={control.checked} onCheckedChange={control.onChange} />
    </label>
  )
}

export function ExportAvenueRow({ autoPost, autoSend, summaryGrain }: ExportAvenueRowProps) {
  return (
    <FieldPanelRow
      title='Export'
      description='Draft, send and, where it applies, grain - together.'>
      <div className='flex items-center gap-4 py-1'>
        {autoPost && (
          <LabeledSwitch
            label='Auto-post'
            hint='On, this posts immediately. Off, it drafts on the ledger for review.'
            control={autoPost}
          />
        )}
        <LabeledSwitch
          label='Auto-send'
          hint='On, a posted entry sends to the provider on its own. Off, its batch holds until released from the outbox.'
          control={autoSend}
        />
        {summaryGrain && (
          <label className='flex flex-col items-start gap-1'>
            <span className='text-muted-foreground text-xs'>Summary grain</span>
            <Select
              value={summaryGrain.value}
              onValueChange={(value) => summaryGrain.onChange(value as SummaryGrain)}>
              <SelectTrigger size='sm' className='h-7 w-32 text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='day'>Per day</SelectItem>
                <SelectItem value='month'>Per month</SelectItem>
              </SelectContent>
            </Select>
          </label>
        )}
      </div>
    </FieldPanelRow>
  )
}
