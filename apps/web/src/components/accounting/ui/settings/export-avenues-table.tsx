// apps/web/src/components/accounting/ui/settings/export-avenues-table.tsx
'use client'

// The Posting page's export table (TARGET §3, §4 gate 2): one row per avenue, with
// autoSend and summaryGrain as columns - laid out like the Settlements rail strip.

import {
  EXPORT_AVENUES,
  type ExportAvenue,
  type SummaryGrain,
} from '@auxx/lib/accounting/ledger/client'
import type { SettingValue } from '@auxx/lib/settings/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Send } from 'lucide-react'
import type { ReactNode } from 'react'
import { EXPORT_AVENUE_LABEL } from '../ledger/export-avenue-labels'
import { EMPTY_CELL } from '../ledger/format'
import {
  autoSendKeyForAvenue,
  postingLabelsForAvenue,
  SUMMARY_GRAIN_LABEL,
  SUMMARY_GRAIN_OPTION_LABEL,
  summaryGrainKeyForAvenue,
  summaryGrainsForAvenue,
} from './posting-page-model'

interface ExportAvenuesTableProps {
  draft: Partial<Record<string, SettingValue>>
  patch: (values: Partial<Record<string, SettingValue>>) => void
}

/** One template for the header and every row, so the columns share widths. */
const EXPORT_COLUMNS = 'grid grid-cols-[5rem_8rem] items-center justify-items-end gap-x-5'

const HEADER_TEXT = 'whitespace-nowrap text-[10px] text-muted-foreground uppercase tracking-wide'

function Cell({ children }: { children: ReactNode }) {
  return <div className='text-right text-sm'>{children}</div>
}

function ColumnHeader() {
  return (
    <div className='flex items-center justify-between gap-4 px-1'>
      <span className={HEADER_TEXT}>Exports as</span>
      <div className={cn(EXPORT_COLUMNS, HEADER_TEXT)}>
        <SimpleTooltip content='On, a posted entry sends to the provider on its own. Off, its batch holds until released from the outbox.'>
          <span>Auto-send</span>
        </SimpleTooltip>
        <span>Summary grain</span>
      </div>
    </div>
  )
}

export function ExportAvenuesTable({ draft, patch }: ExportAvenuesTableProps) {
  function renderRow(avenue: ExportAvenue) {
    const autoSendKey = autoSendKeyForAvenue(avenue)
    const grainKey = summaryGrainKeyForAvenue(avenue)
    const label = EXPORT_AVENUE_LABEL[avenue]
    const grain = (grainKey && (draft[grainKey] as SummaryGrain | undefined)) || 'day'

    return (
      <TreeRow
        icon={<Send />}
        title={label}
        secondary={postingLabelsForAvenue(avenue).join(', ')}
        secondaryFill
        trailing={
          <div className={EXPORT_COLUMNS}>
            <Cell>
              <Switch
                size='xs'
                aria-label={`Auto-send ${label}`}
                checked={!!draft[autoSendKey]}
                onCheckedChange={(checked) => patch({ [autoSendKey]: checked })}
              />
            </Cell>
            <Cell>
              {grainKey ? (
                <Select value={grain} onValueChange={(value) => patch({ [grainKey]: value })}>
                  <SelectTrigger size='sm' className='h-7 w-32 text-xs'>
                    <SelectValue>{SUMMARY_GRAIN_LABEL[grain]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {summaryGrainsForAvenue(avenue).map((option) => (
                      <SelectItem key={option} value={option}>
                        {SUMMARY_GRAIN_OPTION_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className='text-muted-foreground'>{EMPTY_CELL}</span>
              )}
            </Cell>
          </div>
        }
      />
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <ColumnHeader />
      <TreeRowList items={[...EXPORT_AVENUES]} getKey={(avenue) => avenue} renderRow={renderRow} />
    </div>
  )
}
