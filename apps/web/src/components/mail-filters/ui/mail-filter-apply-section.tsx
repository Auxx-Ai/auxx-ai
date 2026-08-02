// apps/web/src/components/mail-filters/ui/mail-filter-apply-section.tsx

'use client'

import { Section } from '@auxx/ui/components/section'
import { Spinner } from '@auxx/ui/components/spinner'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { History } from 'lucide-react'
import type { MailFilterPreview } from '../hooks/use-mail-filter-preview'

interface MailFilterApplySectionProps {
  preview: MailFilterPreview
  applyRetroactively: boolean
  onApplyRetroactivelyChange: (value: boolean) => void
  /** Disable while a save is in flight. */
  disabled?: boolean
}

/**
 * The retroactive-apply opt-in (§6.2 / §6.5), rendered as a `ToggleCard` in its
 * own `Section` so it reads like every other block in the dialog rather than a
 * status strip bolted under the form.
 *
 * The count is stated as a **lower bound**, never as an exact number. Preview
 * evaluates under the requesting user's viewer while the engine fires as SYSTEM
 * (§7), so record-derived grants can make the real set larger. Claiming
 * precision here would be wrong in the one direction that matters: a user who
 * turns this on expecting 12 conversations and gets 30.
 *
 * The switch stays disabled until the preview finds something, so it can never
 * be armed for a backfill that would do nothing.
 */
export function MailFilterApplySection({
  preview,
  applyRetroactively,
  onApplyRetroactivelyChange,
  disabled,
}: MailFilterApplySectionProps) {
  const hasMatches = (preview.count ?? 0) > 0

  return (
    <Section title='Existing mail' icon={<History className='size-4' />} collapsible={false}>
      <ToggleCard
        title='Also apply to existing conversations'
        description={
          <>
            <span className='flex items-center gap-1.5'>
              {preview.isPending && <Spinner className='size-3 shrink-0' />}
              {preview.label}
            </span>
            <span className='block'>
              Approximate. The filter runs as the system, so it may match a few more.
            </span>
          </>
        }
        checked={applyRetroactively}
        onCheckedChange={onApplyRetroactivelyChange}
        disabled={disabled || !hasMatches}
      />
    </Section>
  )
}
