// apps/web/src/components/accounting/ui/journal/journal-entry-drawer.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerFooter, DrawerHeader } from '@auxx/ui/components/drawer'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { BookOpenCheck, ExternalLink } from 'lucide-react'
import { useJournalEntryDraft } from '~/components/accounting/hooks/use-journal-entry-draft'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import type { LedgerBlocker } from '../ledger/entry-blockers'
import { EntryBlockers } from '../ledger/entry-blockers'
import { formatPeriodLabel } from '../ledger/format'
import { JournalLines, JournalLinesTotals } from './journal-lines'
import { firstDayOfPeriod, nextOpenPeriodAfter, periodKeyForEntryDate } from './period-helpers'

const POSTED_STATUSES = new Set(['posted', 'already_posted', 'healed', 'not_connected', 'disabled'])

interface JournalEntryDrawerProps {
  /** The record id, or `null` while `isNew` and the empty draft has not landed yet. */
  journalEntryId: string | null
  isNew: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
  currencyCode: string
  /** `YYYY-MM-DD`. Seeds a brand-new draft's Date field - the viewed period's last day. */
  defaultDate: string
  /** The empty draft was raised - swap `?je=new` for `?je=<id>` without a nav. */
  onCreated: (id: string) => void
  /** The entry posted - close this drawer and open the posting it became. */
  onPosted: (glPostingId: string) => void
  /** View an already-posted entry's posting, without waiting for a new post. */
  onOpenPosting: (glPostingId: string) => void
}

/**
 * The journal entry drawer - HANDOFF slot 1B item 2. `DockableDrawer` in the
 * SAME dock slot `PostingDrawer` uses on the ledger page, opened by `?je=new`
 * or `?je=<id>`.
 *
 * ⚠️ **Attachment: TODO, not wired.** `journal_entry_attachment` (FILE) exists
 * on the entity def (slot 1A), but nothing in this app renders
 * `FieldInputAdapter fieldType={FieldType.FILE}` as a bare value/onChange
 * one-liner anywhere - every FILE field in the app goes through a dedicated
 * uploader wired to `entityInstanceId` + the files pipeline
 * (`docs/files-upload-architecture-guide.md`), which is real work, not a
 * one-liner. Reported in the slot 1B handoff rather than guessed at here.
 */
export function JournalEntryDrawer({
  journalEntryId,
  isNew,
  open,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
  currencyCode,
  defaultDate,
  onCreated,
  onPosted,
  onOpenPosting,
}: JournalEntryDrawerProps) {
  const draft = useJournalEntryDraft({
    journalEntryId,
    isNew,
    defaultDate,
    onCreated,
    onPosted,
  })

  const periodsQuery = api.ledger.periods.useQuery()

  const isEditable = draft.status === 'draft'
  const isLoading = draft.isLoading && !isNew

  const entryPeriodKey = periodKeyForEntryDate(draft.date)

  const blockers: LedgerBlocker[] = []
  if (draft.preview?.blockedBy) {
    blockers.push(draft.preview.blockedBy)
  } else if (draft.postResult && !POSTED_STATUSES.has(draft.postResult.status)) {
    blockers.push({
      status: draft.postResult.status,
      error: draft.postResult.error ?? 'The post was refused.',
    })
  }

  const hasPeriodClosedBlocker = blockers.some((b) => b.status === 'period_closed')
  const nextOpen =
    hasPeriodClosedBlocker && entryPeriodKey
      ? nextOpenPeriodAfter(periodsQuery.data ?? [], entryPeriodKey)
      : null

  function postToNextOpenPeriod() {
    if (!nextOpen) return
    draft.setDate(firstDayOfPeriod(nextOpen.periodKey))
  }

  const canPost = isEditable && !!draft.preview && !draft.previewIsStale && !draft.preview.blockedBy

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={420}
      maxWidth={800}
      title='Journal entry'>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<BookOpenCheck className='size-5 text-muted-foreground' />}
          title={
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>
                {isNew && !journalEntryId ? 'New journal entry' : 'Journal entry'}
              </span>
              <StatusBadge status={draft.status} />
            </div>
          }
          onClose={() => onOpenChange(false)}
        />

        {isLoading ? (
          <div className='flex flex-col gap-2 p-4'>
            <Skeleton className='h-32 w-full' />
            <Skeleton className='h-48 w-full' />
          </div>
        ) : (
          <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
            <div className='flex flex-col gap-3 p-3'>
              {!isEditable && (
                <div className='flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm'>
                  <span className='text-muted-foreground'>
                    This entry is {draft.status} and can no longer be edited here.
                  </span>
                  {draft.glPostingId && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => draft.glPostingId && onOpenPosting(draft.glPostingId)}>
                      <ExternalLink />
                      View posting
                    </Button>
                  )}
                </div>
              )}

              <FieldPanel
                orientation='responsive'
                breakpoint='md'
                resizeId='journal-entry-form'
                defaultLabelWidth={110}
                className='p-0'>
                <FieldPanelRow title='Date' type={BaseType.DATE} showIcon isRequired>
                  <FieldInputAdapter
                    fieldType={FieldType.DATE}
                    value={draft.date ? `${draft.date}T00:00:00.000Z` : null}
                    onChange={(value) => {
                      const iso = value as string | null
                      if (iso) draft.setDate(iso.slice(0, 10))
                    }}
                    disabled={!isEditable}
                  />
                </FieldPanelRow>

                <FieldPanelRow
                  title='Period'
                  type={BaseType.STRING}
                  showIcon
                  description='The calendar month of the date above. Changing the date can move it.'>
                  <div className='flex h-8 items-center'>
                    <Badge variant='outline' size='sm'>
                      {entryPeriodKey ? formatPeriodLabel(entryPeriodKey) : 'Unknown'}
                    </Badge>
                  </div>
                </FieldPanelRow>

                <FieldPanelRow title='Memo' type={BaseType.STRING} showIcon>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={draft.memo}
                    onChange={(value) => draft.setMemo((value as string | null) ?? '')}
                    placeholder='What this entry is for'
                    disabled={!isEditable}
                  />
                </FieldPanelRow>

                <FieldPanelRow
                  title='Attachment'
                  type={BaseType.STRING}
                  showIcon
                  description='Not wired yet - see this file header. TODO for a follow-up slot.'>
                  <span className='flex h-8 items-center text-sm text-muted-foreground'>
                    Not available yet
                  </span>
                </FieldPanelRow>
              </FieldPanel>

              <Section
                title='Lines'
                icon={<BookOpenCheck className='size-4' />}
                collapsible={false}>
                <div className='flex flex-col gap-3'>
                  <JournalLines
                    rows={draft.lines}
                    onChange={draft.setLines}
                    currencyCode={currencyCode}
                    disabled={!isEditable}
                  />
                  <JournalLinesTotals rows={draft.lines} currencyCode={currencyCode} />
                </div>
              </Section>

              {blockers.length > 0 && (
                <EntryBlockers blockers={blockers} onPostToNextPeriod={postToNextOpenPeriod} />
              )}
            </div>
          </ScrollArea>
        )}

        <DrawerFooter className='flex-row items-center justify-end gap-2 border-t'>
          <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          {isEditable && (
            <>
              <Button
                variant='outline'
                size='sm'
                loading={draft.isSaving}
                loadingText='Saving...'
                disabled={!journalEntryId}
                onClick={draft.saveDraft}>
                Save draft
              </Button>
              <Button
                variant='outline'
                size='sm'
                loading={draft.isPreviewing}
                loadingText='Building...'
                disabled={!journalEntryId}
                onClick={draft.runPreview}>
                Preview
              </Button>
              <Button
                variant='outline'
                size='sm'
                loading={draft.isPosting}
                loadingText='Posting...'
                disabled={!canPost}
                onClick={draft.runPost}
                data-dialog-submit>
                Post <KbdSubmit variant='outline' size='sm' />
              </Button>
            </>
          )}
        </DrawerFooter>
      </div>
    </DockableDrawer>
  )
}

function StatusBadge({ status }: { status: 'draft' | 'posted' | 'reversed' }) {
  if (status === 'draft')
    return (
      <Badge variant='outline' size='sm'>
        Draft
      </Badge>
    )
  if (status === 'posted')
    return (
      <Badge variant='green' size='sm'>
        Posted
      </Badge>
    )
  return (
    <Badge variant='amber' size='sm'>
      Reversed
    </Badge>
  )
}
