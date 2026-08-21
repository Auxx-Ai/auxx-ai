// apps/web/src/components/data-import/column-mapping/import-mode-selector.tsx

'use client'

import type { ImportStrategyMode } from '@auxx/lib/import/client'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ChevronsUpDown, Plus, RefreshCw, Repeat } from 'lucide-react'
import { useState } from 'react'
import { type PolicyTabOption, PolicyTabs } from './policy-tabs'

/**
 * The three modes in USER language.
 *
 * Never render the enum names. `create-or-update` is the only mode where
 * running the same file twice is a no-op, and that is the sentence that decides
 * which one someone picks — which is why it stays on screen under the strip
 * rather than living in a tooltip.
 */
const MODE_OPTIONS: Array<
  PolicyTabOption<ImportStrategyMode> & {
    /** Shown on the trigger button, alongside the icon. */
    short: string
    icon: typeof Plus
    /** Requires at least one identifier column. */
    needsIdentifier: boolean
  }
> = [
  {
    value: 'create',
    label: 'Create',
    short: 'Create only',
    icon: Plus,
    description: 'Every row becomes a new record, even if a matching one already exists.',
    needsIdentifier: false,
  },
  {
    value: 'update',
    label: 'Update',
    short: 'Update only',
    icon: RefreshCw,
    description: 'Rows with no matching record are reported as unmatched, not imported.',
    needsIdentifier: true,
  },
  {
    value: 'create-or-update',
    label: 'Create or update',
    short: 'Create or update',
    icon: Repeat,
    description:
      'Matched rows update, the rest are created. Running the same file twice is a no-op.',
    badge: 'Recommended.',
    needsIdentifier: true,
  },
]

const NO_IDENTIFIER_REASON =
  'Choose a match key first, flag a column with the key button to say which field identifies an existing record.'

interface ImportModeSelectorProps {
  /**
   * The mode as the SERVER holds it.
   *
   * Read back, never computed locally. The server flips the default to
   * `create-or-update` the first time an identifier column is flagged and back
   * to `create` when the last one is cleared; a client-side guess would disagree
   * with what the plan actually runs.
   */
  mode: ImportStrategyMode
  /** Field keys forming the match key. Empty ⇒ create-only, whatever the mode says. */
  identifierFieldKeys: string[]
  disabled?: boolean
  onChange: (mode: ImportStrategyMode) => void
}

/**
 * Job-level import mode, on the mapping step.
 *
 * Per JOB, not per column, which is why it sits in the step header rather than
 * on a mapping row.
 */
export function ImportModeSelector({
  mode,
  identifierFieldKeys,
  disabled,
  onChange,
}: ImportModeSelectorProps) {
  const [open, setOpen] = useState(false)
  const hasIdentifier = identifierFieldKeys.length > 0

  const selected = MODE_OPTIONS.find((option) => option.value === mode) ?? MODE_OPTIONS[0]!

  // Disabled AND explained. A mode that is simply greyed out reads as broken;
  // the reason names the control that unblocks it, in the tooltip and in the
  // description line both.
  const options = MODE_OPTIONS.map((option) => {
    const blocked = option.needsIdentifier && !hasIdentifier
    return blocked
      ? { ...option, disabled: true, tooltip: NO_IDENTIFIER_REASON, badge: undefined }
      : option
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}>
          <selected.icon />
          {selected.short}
          <ChevronsUpDown className='opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[340px] p-0' align='end'>
        <div className='border-b px-3 py-2'>
          <p className='text-sm font-medium'>What should this import do?</p>
          <p className='text-xs text-muted-foreground'>
            {hasIdentifier
              ? `Matching on ${identifierFieldKeys.join(' + ')}`
              : 'No match key chosen, only creating is possible'}
          </p>
        </div>
        <div className='px-3 py-2.5'>
          <PolicyTabs value={mode} options={options} onValueChange={onChange} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
