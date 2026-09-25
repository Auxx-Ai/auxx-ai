// apps/web/src/components/accounting/ui/journal/journal-entry-drawer.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { didLedgerAccept } from '@auxx/lib/accounting/ledger/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerFooter, DrawerHeader } from '@auxx/ui/components/drawer'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Ban, BookOpenCheck, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useDiscardJournalEntry } from '~/components/accounting/hooks/use-discard-journal-entry'
import { useJournalEntryDraft } from '~/components/accounting/hooks/use-journal-entry-draft'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import type { RecordId } from '~/components/resources'
import { useResourceFields } from '~/components/resources/hooks/use-resource-fields'
import { BaseType } from '~/components/workflow/types'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import type { LedgerBlocker } from '../ledger/entry-blockers'
import { EntryBlockers } from '../ledger/entry-blockers'
import { formatPeriodLabel } from '../ledger/format'
import { JournalEntryAttachment } from './journal-entry-attachment'
import { JournalLines, JournalLinesTotals } from './journal-lines'
import { periodKeyForEntryDate } from './period-helpers'

interface JournalEntryDrawerProps {
  /** The record id, or `null` while `isNew` and the first Save has not created it. */
  journalEntryId: string | null
  isNew: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
  currencyCode: string
  /** `YYYY-MM-DD`. Seeds a brand-new entry's Date field - the viewed period's last day. */
  defaultDate: string
  /** The first Save created the record - swap `?je=new` for `?je=<id>` without a nav. */
  onCreated: (id: string) => void
  /** The entry posted - close this drawer and open the posting it became. */
  onPosted: (glPostingId: string) => void
  /** View an already-posted entry's posting. */
  onOpenPosting: (glPostingId: string) => void
  /** The entry and its lines were deleted - close the drawer. */
  onDiscarded: () => void
  /** What a NEW record is. A `recurring_template` never posts, so Preview and Post are hidden. */
  kind?: 'manual' | 'recurring_template'
}

/**
 * The journal entry document drawer (91 D5), opened by `?je=new` or `?je=<id>`.
 * Actions follow the record's own status: `draft` saves, previews, posts and
 * discards; `posted` voids, or (manual only) edits in place through `documentEdit`.
 * The Attachment row needs a saved record, so it waits for the first Save.
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
  onDiscarded,
  kind = 'manual',
}: JournalEntryDrawerProps) {
  const draft = useJournalEntryDraft({
    journalEntryId,
    isNew,
    defaultDate,
    onCreated,
    onPosted,
    kind,
  })

  const isTemplate = kind === 'recurring_template'

  const { can } = useAccess()

  // `journal_entry` is a HIDDEN def (`isVisible: false`), which is fine here:
  // `resource.list` returns the whole org resources cache unfiltered, and only
  // the sidebar reads `isVisible`. `null` on an org that has not picked up the
  // field yet, in which case the row renders a sentence instead of a picker.
  const { fields: journalEntryFields } = useResourceFields('journal-entries')
  const attachmentField = useMemo(
    () => journalEntryFields.find((f) => f.key === 'attachment') ?? null,
    [journalEntryFields]
  )

  const discard = useDiscardJournalEntry({ onDiscarded })
  const [confirm, ConfirmDialog] = useConfirm()

  const isDraft = draft.status === 'draft'
  const isEditable = isDraft || draft.editing
  const isLoading = draft.isLoading && !isNew
  const canWrite = can('ledger.post')

  const entryPeriodKey = periodKeyForEntryDate(draft.date)

  const blockers: LedgerBlocker[] = []
  // First: it is about the action just taken, not an earlier preview.
  if (discard.refusal) {
    blockers.push({ status: 'discard_refused', error: discard.refusal })
  }
  if (draft.preview?.blockedBy) {
    blockers.push(draft.preview.blockedBy)
  } else if (draft.postResult && !didLedgerAccept(draft.postResult)) {
    blockers.push({
      status: draft.postResult.status,
      error: draft.postResult.error ?? 'The ledger refused it.',
      ...(draft.postResult.items?.length ? { items: draft.postResult.items } : {}),
    })
  }

  const canPost = isDraft && !!draft.preview && !draft.previewIsStale && !draft.preview.blockedBy
  const canDiscard = !!journalEntryId && isDraft && canWrite && !isLoading
  const isPosted = draft.status === 'posted' && !isTemplate
  const canEditInPlace = isPosted && draft.kind === 'manual' && canWrite && !draft.editing

  async function requestVoid() {
    const confirmed = await confirm({
      title: `Void ${draft.number ?? 'this journal entry'}?`,
      description:
        'An opposite entry is posted to back this one out. Both stay in the ledger, and the ' +
        'entry reads Reversed.',
      confirmText: 'Void',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) draft.runVoid()
  }

  async function requestCancelEdit() {
    const confirmed = await confirm({
      title: 'Discard these changes?',
      description:
        'The entry returns to what it was when Edit was pressed. The ledger was never touched.',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) draft.cancelEdit()
  }

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={420}
      maxWidth={800}
      title={isTemplate ? 'Recurring template' : 'Journal entry'}>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<BookOpenCheck className='size-5 text-muted-foreground' />}
          title={
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>
                {isTemplate
                  ? isNew && !journalEntryId
                    ? 'New recurring template'
                    : 'Recurring template'
                  : isNew && !journalEntryId
                    ? 'New journal entry'
                    : 'Journal entry'}
              </span>
              {isTemplate ? (
                <Badge variant='outline' size='sm'>
                  Template
                </Badge>
              ) : (
                <StatusBadge status={draft.status} />
              )}
            </div>
          }
          actions={
            canDiscard && (
              <Button
                variant='ghost'
                size='xs'
                className='text-destructive hover:text-destructive'
                loading={discard.isDiscarding}
                loadingText='Discarding...'
                onClick={() =>
                  journalEntryId &&
                  void discard.requestDiscard({ id: journalEntryId, number: draft.number })
                }>
                <Trash2 />
                Discard
              </Button>
            )
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
            {/* 🛑 No padding and no gap, deliberately - see the same note in
                `posting-frame.tsx`. `Section` draws its own `p-3 pb-4` and a
                full-width `border-b`, so sections stack FLUSH and that border is
                the divider. This wrapper used to carry `gap-3 p-3`, which is
                why the Lines section had grown a `-mx-3` bleed to claw itself
                back out to the edge; the bleed is deleted with it. Anything
                that is NOT a Section carries its own padding below. */}
            <div className='flex flex-col'>
              {draft.editing && (
                <Alert variant='neutral' className='mx-3 mt-3 w-auto'>
                  <AlertDescription>
                    Editing a posted entry. Save reverses it and posts the corrected entry if the
                    lines changed; Cancel restores it.
                  </AlertDescription>
                </Alert>
              )}
              {!isEditable && (
                <Alert variant='neutral' className='mx-3 mt-3 w-auto'>
                  <AlertDescription>
                    {draft.status === 'reversed'
                      ? 'This entry was voided. Post a new entry to correct the books.'
                      : 'This entry is posted. Edit it to correct it, or void it to back it out.'}
                  </AlertDescription>
                  {draft.glPostingId && (
                    <Button
                      variant='outline'
                      size='sm'
                      className='mt-2 justify-self-start'
                      onClick={() => draft.glPostingId && onOpenPosting(draft.glPostingId)}>
                      <ExternalLink />
                      View posting
                    </Button>
                  )}
                </Alert>
              )}

              {/* ⚠️ NOT wrapped in a `Section`. `FieldPanel` draws its own
                  `rounded-2xl border` card, so a Section around it nests two
                  boxes - and the record drawer's own Details block, the thing
                  this screen is matching, is a Section over PLAIN rows
                  (`fields-block.tsx` renders `EntityFields`), never a card in a
                  card. The panel keeps its chrome and carries the padding the
                  scroll wrapper no longer has. */}
              <div className='p-3'>
                <FieldPanel
                  orientation='responsive'
                  breakpoint='md'
                  resizeId='journal-entry-form'
                  defaultLabelWidth={110}
                  className='p-0'>
                  <FieldPanelRow
                    title={isTemplate ? 'Starts' : 'Date'}
                    type={BaseType.DATE}
                    showIcon
                    isRequired
                    description={
                      isTemplate
                        ? 'The first occurrence. The schedule expands from here, and every generated entry takes its own occurrence date.'
                        : undefined
                    }>
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

                  {/* A template belongs to no period: it posts nothing, and each
                    occurrence it generates lands in its own month. */}
                  {!isTemplate && (
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
                  )}

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
                    type={BaseType.FILE}
                    showIcon
                    description="The evidence behind the entry - the accountant's memo, a statement, a photo of the paper">
                    {attachmentField && journalEntryId ? (
                      <JournalEntryAttachment
                        recordId={journalEntryId as RecordId}
                        field={attachmentField}
                      />
                    ) : (
                      <span className='flex h-8 items-center text-muted-foreground text-sm'>
                        {attachmentField
                          ? 'Save the entry first - a file needs an entry to hang on'
                          : 'Not available on this organization yet'}
                      </span>
                    )}
                  </FieldPanelRow>
                </FieldPanel>
              </div>

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
                <div className='p-3'>
                  <EntryBlockers blockers={blockers} />
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <DrawerFooter className='flex-row items-center justify-end gap-2 border-t'>
          <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          {draft.editing && canWrite && (
            <>
              <Button
                variant='outline'
                size='sm'
                disabled={draft.isEditPending || draft.isSaving}
                onClick={() => void requestCancelEdit()}>
                Cancel edit
              </Button>
              <Button
                variant='outline'
                size='sm'
                loading={draft.isEditPending || draft.isSaving}
                loadingText='Saving...'
                onClick={draft.saveEdit}
                data-dialog-submit>
                Save <KbdSubmit variant='outline' size='sm' />
              </Button>
            </>
          )}
          {isPosted && canWrite && !draft.editing && (
            <Button
              variant='outline'
              size='sm'
              className='text-destructive hover:text-destructive'
              loading={draft.isVoiding}
              loadingText='Voiding...'
              onClick={() => void requestVoid()}>
              <Ban />
              Void
            </Button>
          )}
          {canEditInPlace && (
            <Button
              variant='outline'
              size='sm'
              loading={draft.isEditPending}
              loadingText='Opening...'
              onClick={draft.openEdit}>
              <Pencil />
              Edit
            </Button>
          )}
          {isDraft && (
            <>
              <Button
                variant='outline'
                size='sm'
                loading={draft.isSaving}
                loadingText='Saving...'
                onClick={draft.save}>
                Save
              </Button>
              {/* A template never posts: both would be refused by name. */}
              {!isTemplate && (
                <>
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
            </>
          )}
        </DrawerFooter>
      </div>
      <discard.ConfirmDialog />
      <ConfirmDialog />
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
