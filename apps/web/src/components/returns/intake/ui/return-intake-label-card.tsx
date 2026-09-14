// apps/web/src/components/returns/intake/ui/return-intake-label-card.tsx
'use client'

// One photographed return label, and the question it asks
// (plans/money/tasks/57 §4.4 / §4.5 / §4.6 / §4.7 / §7.2 / §7.3).
//
// 🛑 **Nothing auto-links.** Every label needs an explicit confirmation, and the
// tier is a BADGE and a RANKING — never a pre-selection. §4.4's reason is
// asymmetric risk: a mis-linked quote line shows up as a wrong part on a draft a
// buyer reads line by line, while a mis-linked return silently attaches one
// customer's goods to another customer's order, and the over-return guard then
// computes its ceiling against the wrong order — a refusal nobody can explain.
// So the top candidate is rendered first and is NOT ticked.
//
// 🛑 Three answers, not two. `confirmedContactRecordId` is "this customer",
// `confirmedUnidentified` is "not one of ours" (which still creates a return,
// with `contact` null and the sender kept from the photo, §4.6), and `null` +
// not-unidentified is UNDECIDED. Undecided is in no group and creates nothing.
//
// ⚠️ Two states the card must keep apart, because they are different failures
// and a dock worker acts on them differently (§3.2):
//   - `legible: false`  — the model could not READ the photo. Calm, photo-first,
//     "check it yourself", not an error.
//   - read fine, no candidates — the label is legible and we simply do not know
//     this sender. That is what "not one of ours" is for.
//
// ⚠️ Row chrome, deliberately absent: 38 §11.3 records that the purchase-order
// intake row grew TWO `⋯` menus and a permanent second row under every row, both
// of which the shared line components document against. There is one action
// cluster per card here and no hidden second row.

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/lib/resources/client'
import {
  formatSenderAddress,
  RETURN_INTAKE_TIER_LABELS,
  type ReturnIntakeCandidate,
  type ReturnIntakeLabel,
  type ReturnIntakeOrderOption,
  type ReturnIntakeTier,
} from '@auxx/lib/returns/intake/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import {
  Check,
  ImageOff,
  Minus,
  Package,
  PencilLine,
  Plus,
  ScanLine,
  TriangleAlert,
  UserRoundX,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AttachmentPreview } from '~/components/attachments/attachment-preview'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'

/**
 * The contact picker's escape hatch — the whole customer list, for when none of
 * the ladder's candidates is right.
 *
 * 🛑 `contact`, per `return_fields.contact.relationshipConfig.relatedEntityType`.
 * A company RecordId would survive this whole screen and be rejected at the
 * create path on commit, which is the worst possible moment to find out.
 */
const CONTACT_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('contact', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

const TIER_VARIANT: Record<ReturnIntakeTier, Variant> = {
  address: 'green',
  address_city: 'green',
  name_place: 'blue',
  name: 'amber',
  none: 'gray',
}

/** Why this candidate is where it is in the list. Written for the person. */
function tierReason(tier: ReturnIntakeTier): string {
  switch (tier) {
    case 'address':
      return 'The street and postal code on the label match an order we shipped.'
    case 'address_city':
      return 'The street, city and region match an order we shipped; the postal code did not read.'
    case 'name_place':
      return 'The name matches a customer, narrowed by the city on the label.'
    case 'name':
      return 'Only the name matched. Nothing about the address confirms it is the same person.'
    case 'none':
      return 'Nothing matched this label.'
  }
}

/**
 * The tier, said as a word.
 *
 * 🛑 Never a reason to pre-select. The strongest tier on this screen still gets
 * a human tap; the badge only says where to look first.
 */
export function ReturnIntakeTierBadge({ tier }: { tier: ReturnIntakeTier }) {
  return (
    <SimpleTooltip content={tierReason(tier)}>
      <Badge variant={TIER_VARIANT[tier]} size='sm'>
        {RETURN_INTAKE_TIER_LABELS[tier]}
      </Badge>
    </SimpleTooltip>
  )
}

/**
 * What the manual-entry panel can write (§4.6).
 *
 * 🛑 The keys are exactly `patchLabelTranscription`'s, minus `recipientNameRaw`
 * (it feeds §4.7's outbound check, which the ladder already ran) and minus
 * `legible` (the model's own answer, which no client may write).
 */
export interface ReturnIntakeLabelPatch {
  senderName?: string | null
  senderStreet1?: string | null
  senderStreet2?: string | null
  senderCity?: string | null
  senderRegion?: string | null
  senderPostalCode?: string | null
  senderCountry?: string | null
  carrier?: string | null
  trackingNumber?: string | null
  ourReferenceRaw?: string | null
}

/** The panel's rows, in the order a label prints them. */
const MANUAL_FIELDS = [
  { key: 'senderName', title: 'Sender', placeholder: 'Who sent it back' },
  { key: 'senderStreet1', title: 'Street', placeholder: 'First address line' },
  { key: 'senderStreet2', title: 'Street 2', placeholder: 'Flat, suite, care-of' },
  { key: 'senderCity', title: 'City', placeholder: null },
  { key: 'senderRegion', title: 'Region', placeholder: 'County, state or province' },
  { key: 'senderPostalCode', title: 'Postal code', placeholder: null },
  { key: 'senderCountry', title: 'Country', placeholder: null },
  { key: 'carrier', title: 'Carrier', placeholder: 'Only if it is printed' },
  { key: 'trackingNumber', title: 'Tracking', placeholder: null },
  { key: 'ourReferenceRaw', title: 'Written on it', placeholder: 'Any RMA or order number' },
] as const satisfies readonly {
  key: keyof ReturnIntakeLabelPatch
  title: string
  placeholder: string | null
}[]

export interface ReturnIntakeLabelCardProps {
  label: ReturnIntakeLabel
  /** The draft this label belongs to — the photo's preview authorization. */
  draftId: string
  /** 1-based, for "Label 2 of 3" — the worker is holding parcel 2. */
  index: number
  total: number
  /** Orders the confirmed contact could be returning against (§4.5). */
  orderOptions: ReturnIntakeOrderOption[]
  /** True once a contact is confirmed and the options query is still in flight. */
  isLoadingOrderOptions?: boolean
  isPending?: boolean
  onConfirmContact: (contactRecordId: RecordId) => void
  onConfirmUnidentified: () => void
  /** Clear this label's answer, back to undecided. */
  onReopen: () => void
  onChooseOrder: (orderRecordId: RecordId | null) => void
  /** Save what the worker typed off the photo (§4.6). Partial. */
  onPatchTranscription: (patch: ReturnIntakeLabelPatch) => void
}

export function ReturnIntakeLabelCard({
  label,
  draftId,
  index,
  total,
  orderOptions,
  isLoadingOrderOptions = false,
  isPending = false,
  onConfirmContact,
  onConfirmUnidentified,
  onReopen,
  onChooseOrder,
  onPatchTranscription,
}: ReturnIntakeLabelCardProps) {
  const transcription = label.transcription

  // 🔑 **The model's reading and everything else are DIFFERENT BLOCKS, and that
  // is the whole provenance mechanism.** `legible` is the model's own answer and
  // nothing but the model ever writes it (see
  // `patchReturnIntakeLabelTranscription`), so:
  //   - `legible: true`  → `Transcription`, read-only. This is what the machine
  //     read, and it must never be silently editable (§3.2).
  //   - anything else    → `ManualTranscription`, editable, and it says plainly
  //     that these values are NOT the model's reading. Text a worker types can
  //     therefore never come back looking like a transcription, and a label the
  //     model half-read but did not trust is presented the same honest way.
  //
  // ⚠️ A label whose CALL failed has no transcription at all, only an `error`.
  // It gets the editable panel too — it is otherwise the one kind of label that
  // cannot be typed in, and it reaches commit with an empty sender exactly like
  // an illegible one does.
  const readByModel = transcription?.legible === true
  const needsManualEntry = !readByModel && (transcription !== null || label.error !== null)

  // "Change" shows the picker again immediately AND clears the stored answer
  // through `onReopen`.
  //
  // 🛑 Both halves matter. The local flag is what makes the tap feel instant
  // over a round trip; the clear is what keeps the group summary honest — a
  // worker who taps Change and is then called away must not leave a match they
  // had just called wrong sitting in the list of returns about to be created.
  const [reopened, setReopened] = useState(false)
  const answer = `${label.confirmedContactRecordId ?? ''}|${label.confirmedUnidentified}`
  const answeredAt = useRef(answer)
  if (answeredAt.current !== answer) {
    answeredAt.current = answer
    if (reopened) setReopened(false)
  }
  const decided =
    !reopened && (label.confirmedUnidentified || label.confirmedContactRecordId !== null)

  // §4.5: exactly one shipped order preselects, and stays visibly changeable.
  //
  // ⚠️ Guarded by the (label, contact) pair rather than a boolean, so re-picking
  // a different contact preselects again while clearing the order by hand does
  // NOT get silently undone on the next render.
  const autoPickedFor = useRef<string | null>(null)
  const contactRecordId = label.confirmedContactRecordId
  const confirmedOrderRecordId = label.confirmedOrderRecordId
  const soleOption = orderOptions.length === 1 ? orderOptions[0] : undefined
  useEffect(() => {
    if (contactRecordId === null || confirmedOrderRecordId !== null || !soleOption) return
    const key = `${label.id}:${contactRecordId}`
    if (autoPickedFor.current === key) return
    autoPickedFor.current = key
    onChooseOrder(soleOption.orderRecordId)
  }, [label.id, contactRecordId, confirmedOrderRecordId, soleOption, onChooseOrder])

  return (
    <section
      data-testid={`label-card-${label.id}`}
      className='flex flex-col gap-3 rounded-2xl border p-3'>
      <header className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground text-xs'>
          Label {index} of {total}
        </span>
        <span className='min-w-0 truncate font-medium text-sm'>{label.fileName}</span>
        {readByModel && <ReturnIntakeTierBadge tier={label.bestTier} />}
        <span className='ms-auto'>
          <StatusBadge label={label} />
        </span>
      </header>

      {/* 🔑 §7.3: it is a phone at a dock. The photo sits beside the fields on a
          desktop and STACKS below `lg`, photo first — checking a transcription
          against a crumpled label is the entire job of this screen. */}
      <div className='grid gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]'>
        <LabelPhoto draftId={draftId} fileRef={label.fileRef} fileName={label.fileName} />

        <div className='flex min-w-0 flex-col gap-3'>
          {label.error !== null && (
            <Alert variant='destructive'>
              <TriangleAlert className='size-4' />
              <AlertTitle>This photo could not be read</AlertTitle>
              <AlertDescription>{label.error}</AlertDescription>
            </Alert>
          )}

          {/* 🛑 §4.7: a WARNING, never a refusal. A worker may legitimately be
              returning something to a vendor, and the card stays fully usable. */}
          {label.looksOutbound && (
            <Alert data-testid={`outbound-warning-${label.id}`}>
              <TriangleAlert className='size-4' />
              <AlertTitle>This looks like an outbound label</AlertTitle>
              <AlertDescription>
                The parcel is addressed to someone else, not to us. That happens when the wrong side
                of a box is photographed. Carry on if you meant it &mdash; sending goods back to a
                vendor looks exactly like this.
              </AlertDescription>
            </Alert>
          )}

          {needsManualEntry ? (
            <ManualTranscription
              label={label}
              isPending={isPending}
              onPatchTranscription={onPatchTranscription}
            />
          ) : readByModel && transcription !== null ? (
            <Transcription
              senderName={transcription.senderName}
              senderAddress={formatSenderAddress(transcription)}
              carrier={transcription.carrier}
              trackingNumber={transcription.trackingNumber}
              ourReferenceRaw={transcription.ourReferenceRaw}
            />
          ) : (
            <p className='text-muted-foreground text-sm'>Still reading this label&hellip;</p>
          )}

          {decided ? (
            <DecidedPanel
              label={label}
              isPending={isPending}
              onReopen={() => {
                setReopened(true)
                onReopen()
              }}
              senderName={transcription?.senderName ?? null}
              senderAddress={transcription ? formatSenderAddress(transcription) : null}
            />
          ) : (
            <ContactQuestion
              label={label}
              isPending={isPending}
              onConfirmContact={onConfirmContact}
              onConfirmUnidentified={onConfirmUnidentified}
            />
          )}

          {label.confirmedContactRecordId !== null && (
            <OrderQuestion
              label={label}
              orderOptions={orderOptions}
              isLoading={isLoadingOrderOptions}
              isPending={isPending}
              onChooseOrder={onChooseOrder}
            />
          )}
        </div>
      </div>
    </section>
  )
}

/** Confirmed / not ours / undecided, said once, in the header. */
function StatusBadge({ label }: { label: ReturnIntakeLabel }) {
  if (label.confirmedUnidentified) {
    return (
      <Badge variant='amber' size='sm' data-testid={`status-${label.id}`}>
        <UserRoundX className='size-3' />
        Not one of ours
      </Badge>
    )
  }
  if (label.confirmedContactRecordId !== null) {
    return (
      <Badge variant='green' size='sm' data-testid={`status-${label.id}`}>
        <Check className='size-3' />
        Confirmed
      </Badge>
    )
  }
  return (
    <Badge variant='outline' size='sm' data-testid={`status-${label.id}`}>
      Needs confirming
    </Badge>
  )
}

/**
 * The photo, zoomable.
 *
 * §7.3: the photo must stay pinchable. `touch-pinch-zoom` lets the browser's own
 * pinch gesture through on the pane (instead of the page swallowing it), and the
 * explicit steps are the same affordance for a mouse and for a gloved thumb.
 *
 * 🛑 **The preview scope is `returnIntakeDraft`, never the default `files`.** The
 * default runs `FeatureKey.files` + `filesView`, so a dock account with returns
 * access and no Files app would get an empty pane and no explanation — on the one
 * screen whose entire job is checking a transcription against the photo. The
 * scope authorizes the asset against the DRAFT instead (viewing `return`, plus
 * proof that this asset is one of that draft's labels); see
 * `assertReturnIntakeDraftAssetAccess`. The vendor-quote path hit exactly this
 * and grew the same scope (38 §6.2).
 */
function LabelPhoto({
  draftId,
  fileRef,
  fileName,
}: {
  draftId: string
  fileRef: string
  fileName: string
}) {
  const [zoom, setZoom] = useState(1)
  const assetId = fileRef.replace(/^asset:/, '')

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='min-h-56 touch-pinch-zoom overflow-auto rounded-xl border bg-muted/40 lg:h-80'>
        <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} className='min-h-56'>
          <AttachmentPreview
            type='asset'
            id={assetId}
            preferredRenderer='image'
            width='100%'
            height='100%'
            filename={fileName}
            scope={{ kind: 'returnIntakeDraft', draftId }}
          />
        </div>
      </div>
      <div className='flex items-center gap-1'>
        <Button
          variant='ghost'
          size='xs'
          aria-label='Zoom out'
          disabled={zoom <= 1}
          onClick={() => setZoom((current) => Math.max(1, Math.round((current - 0.5) * 2) / 2))}>
          <Minus />
        </Button>
        <span className='w-10 text-center text-muted-foreground text-xs tabular-nums'>
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant='ghost'
          size='xs'
          aria-label='Zoom in'
          disabled={zoom >= 4}
          onClick={() => setZoom((current) => Math.min(4, Math.round((current + 0.5) * 2) / 2))}>
          <Plus />
        </Button>
        <span className='ms-auto text-muted-foreground text-xs'>Pinch to zoom</span>
      </div>
    </div>
  )
}

/**
 * What the model read, as printed.
 *
 * Rendered read-only: the model transcribes and never infers (§3.2), and a field
 * that can be silently corrected here would destroy the one fact this pane
 * carries. Nothing on this screen has a procedure to write a transcription back.
 */
function Transcription({
  senderName,
  senderAddress,
  carrier,
  trackingNumber,
  ourReferenceRaw,
}: {
  senderName: string | null
  senderAddress: string | null
  carrier: string | null
  trackingNumber: string | null
  ourReferenceRaw: string | null
}) {
  return (
    <dl className='grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm'>
      <TranscriptionRow term='Sender' value={senderName} />
      <TranscriptionRow term='Address' value={senderAddress} multiline />
      <TranscriptionRow term='Carrier' value={carrier} />
      <TranscriptionRow term='Tracking' value={trackingNumber} mono />
      <TranscriptionRow term='Written on it' value={ourReferenceRaw} mono />
    </dl>
  )
}

function TranscriptionRow({
  term,
  value,
  mono = false,
  multiline = false,
}: {
  term: string
  value: string | null
  mono?: boolean
  multiline?: boolean
}) {
  return (
    <>
      <dt className='text-muted-foreground text-xs'>{term}</dt>
      <dd
        className={cn(
          'min-w-0 break-words',
          mono && 'font-mono text-xs',
          multiline && 'whitespace-pre-line',
          value === null && 'text-muted-foreground/60'
        )}>
        {/* A blank field is a FACT, and it is said as one rather than hidden. */}
        {value ?? 'not printed'}
      </dd>
    </>
  )
}

/** The label's patchable fields as a form's worth of strings. */
function storedManualValues(label: ReturnIntakeLabel): Record<string, string> {
  const transcription = label.transcription
  const values: Record<string, string> = {}
  for (const field of MANUAL_FIELDS) {
    values[field.key] = transcription?.[field.key] ?? ''
  }
  return values
}

/**
 * The label, typed in by a person (§4.6).
 *
 * 🛑 **This is what stops the unannounced pallet becoming an empty record.** §4.6
 * says to "fill `senderNameRaw` and `senderAddressRaw` from the transcription,
 * leave `contact` and `order` null" — and `commit.ts` reads exactly
 * `label.transcription` for both. With no transcription and no way to enter one,
 * the 15% of returns this feature exists for produced a return with nothing
 * identifying on it at all.
 *
 * 🛑 **It never claims to be the model's reading.** `legible` stays whatever the
 * model said; this panel is rendered *because* the model did not vouch for this
 * label, and it says so in as many words. The read-only {@link Transcription}
 * block is the only thing on this screen that presents a machine read as one.
 *
 * ⚠️ One Save for the whole panel, not a write per blur. The review route
 * re-reads the draft after every mutation, so ten per-field saves would be ten
 * refetches under a person's thumb — and a dock worker types the block, then
 * looks up.
 */
function ManualTranscription({
  label,
  isPending,
  onPatchTranscription,
}: {
  label: ReturnIntakeLabel
  isPending: boolean
  onPatchTranscription: (patch: ReturnIntakeLabelPatch) => void
}) {
  const stored = storedManualValues(label)
  const storedKey = JSON.stringify(stored)
  const [values, setValues] = useState(stored)

  // Re-seed when the SAVED values actually change, compared by content rather
  // than by object identity: the route refetches the whole draft after every
  // answer on every card, and re-seeding on identity would wipe a half-typed
  // address out from under the person typing it.
  const seededFrom = useRef(storedKey)
  if (seededFrom.current !== storedKey) {
    seededFrom.current = storedKey
    setValues(stored)
  }

  const changed = MANUAL_FIELDS.filter((field) => values[field.key] !== stored[field.key])
  const anythingEntered = MANUAL_FIELDS.some((field) => stored[field.key] !== '')

  const handleSave = () => {
    if (changed.length === 0) return
    // ⚠️ Only the keys that changed. The patch is partial all the way down, so a
    // worker who reads the street and not the name does not blank the rest.
    const patch: ReturnIntakeLabelPatch = {}
    for (const field of changed) {
      const next = values[field.key]?.trim() ?? ''
      patch[field.key] = next === '' ? null : next
    }
    onPatchTranscription(patch)
  }

  return (
    <div
      data-testid={`manual-entry-${label.id}`}
      className='flex flex-col gap-2 rounded-xl border border-dashed p-3'>
      {anythingEntered ? (
        <>
          <span className='flex items-center gap-1.5 font-medium text-sm'>
            <PencilLine className='size-4 shrink-0' />
            Read off the photo by hand
          </span>
          <span className='text-muted-foreground text-xs'>
            The model could not vouch for this label, so nothing below is a machine read. Check
            every line against the photo and correct it before confirming.
          </span>
        </>
      ) : (
        <>
          <span
            className='flex items-center gap-1.5 font-medium text-sm'
            data-testid={`illegible-${label.id}`}>
            <ImageOff className='size-4 shrink-0' />
            Nothing could be read off this label
          </span>
          <span className='text-muted-foreground text-xs'>
            Type what you can see in the photo and pick the customer below. If you cannot place the
            sender either, &quot;not one of ours&quot; still books the parcel in &mdash; with
            whatever you enter here as the only record of who sent it.
          </span>
        </>
      )}

      <FieldPanel
        orientation='responsive'
        breakpoint='sm'
        resizeId='return-intake-label'
        defaultLabelWidth={120}
        className='p-0'>
        {MANUAL_FIELDS.map((field) => (
          <FieldPanelRow key={field.key} title={field.title}>
            <div data-testid={`manual-${label.id}-${field.key}`}>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={values[field.key] ?? ''}
                onChange={(next) =>
                  setValues((current) => ({ ...current, [field.key]: String(next ?? '') }))
                }
                disabled={isPending}
                placeholder={field.placeholder ?? undefined}
              />
            </div>
          </FieldPanelRow>
        ))}
      </FieldPanel>

      <Button
        variant='outline'
        size='sm'
        className='self-start'
        disabled={isPending || changed.length === 0}
        data-testid={`save-transcription-${label.id}`}
        onClick={handleSave}>
        <Check />
        Save what I read
      </Button>
    </div>
  )
}

/**
 * "Who sent it?" — the one question this card exists to ask.
 *
 * 🛑 Nothing is ticked when this renders. The candidates are ordered by the
 * ladder and that is the entire help they give.
 */
function ContactQuestion({
  label,
  isPending,
  onConfirmContact,
  onConfirmUnidentified,
}: {
  label: ReturnIntakeLabel
  isPending: boolean
  onConfirmContact: (contactRecordId: RecordId) => void
  onConfirmUnidentified: () => void
}) {
  return (
    <div className='flex flex-col gap-2'>
      <span className='font-medium text-sm'>Who sent it?</span>

      {label.candidates.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          No customer matched this label. Search for one below, or book it in as unidentified.
        </p>
      ) : (
        <ul className='flex flex-col gap-1' data-testid={`candidates-${label.id}`}>
          {label.candidates.map((candidate) => (
            <li key={`${candidate.contactRecordId}:${candidate.orderRecordId ?? 'none'}`}>
              <CandidateRow
                candidate={candidate}
                disabled={isPending}
                onPick={() => onConfirmContact(candidate.contactRecordId)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <div className='min-w-48 flex-1'>
          <FieldInputAdapter
            fieldType={FieldType.RELATIONSHIP}
            value={[]}
            onChange={(value) => {
              const first = (value as RecordId[])[0]
              if (first) onConfirmContact(first)
            }}
            disabled={isPending}
            triggerProps={{ className: 'w-full' }}
            placeholder={label.candidates.length === 0 ? 'Search customers...' : 'Someone else...'}
            fieldOptions={{
              relationship: CONTACT_RELATIONSHIP,
              showDefinitionIcon: true,
              showSecondary: true,
            }}
          />
        </div>

        {/* 🛑 §4.6 is not a dead end and must not read like one: this CREATES a
            return, with the sender kept from the photo. The button says so. */}
        <Button
          variant='outline'
          size='sm'
          disabled={isPending}
          data-testid={`unidentified-${label.id}`}
          onClick={onConfirmUnidentified}>
          <UserRoundX />
          Not one of ours
        </Button>
      </div>
    </div>
  )
}

function CandidateRow({
  candidate,
  disabled,
  onPick,
}: {
  candidate: ReturnIntakeCandidate
  disabled: boolean
  onPick: () => void
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'flex w-full flex-wrap items-center gap-2 rounded-xl bg-primary-50 px-2.5 py-2 text-start text-sm',
        'hover:bg-primary-100 disabled:opacity-50'
      )}>
      <span className='min-w-0 truncate font-medium'>{candidate.contactName}</span>
      {candidate.contactPlace && (
        <span className='min-w-0 truncate text-muted-foreground text-xs'>
          {candidate.contactPlace}
        </span>
      )}
      {candidate.orderNumber && (
        <Badge variant='gray' size='xs'>
          <Package className='size-3' />
          {candidate.orderNumber}
        </Badge>
      )}
      <span className='ms-auto'>
        <ReturnIntakeTierBadge tier={candidate.tier} />
      </span>
    </button>
  )
}

/** The answer, once given — and the way back out of it. */
function DecidedPanel({
  label,
  isPending,
  onReopen,
  senderName,
  senderAddress,
}: {
  label: ReturnIntakeLabel
  isPending: boolean
  onReopen: () => void
  senderName: string | null
  senderAddress: string | null
}) {
  return (
    <div
      data-testid={`decided-${label.id}`}
      className='flex flex-col gap-2 rounded-xl bg-primary-50 p-2.5'>
      {label.confirmedUnidentified ? (
        <div className='flex flex-col gap-0.5 text-sm'>
          <span className='font-medium'>Booked in without a customer</span>
          <span className='text-muted-foreground text-xs'>
            This still becomes a return. The sender stays as read off the photo
            {senderName ? ` — ${senderName}` : ''}, and identification happens later from the
            unidentified queue.
          </span>
          {senderAddress && (
            <span className='whitespace-pre-line text-muted-foreground text-xs'>
              {senderAddress}
            </span>
          )}
        </div>
      ) : (
        <div className='flex min-w-0 items-center gap-2 text-sm'>
          <Check className='size-4 shrink-0 text-green-600' />
          <span className='min-w-0 flex-1'>
            <FieldInputAdapter
              fieldType={FieldType.RELATIONSHIP}
              value={label.confirmedContactRecordId ? [label.confirmedContactRecordId] : []}
              onChange={() => {}}
              disabled
              triggerProps={{ className: 'w-full' }}
              fieldOptions={{
                relationship: CONTACT_RELATIONSHIP,
                showDefinitionIcon: true,
                showSecondary: true,
              }}
            />
          </span>
        </div>
      )}

      <Button
        variant='ghost'
        size='xs'
        className='self-start'
        disabled={isPending}
        data-testid={`reopen-${label.id}`}
        onClick={onReopen}>
        <ScanLine />
        Change
      </Button>
    </div>
  )
}

/**
 * Which order, once the customer is a confirmed fact (§4.5).
 *
 * 🔑 Not a fuzzy auto-link and no violation of §4.4: the fuzzy step was the
 * contact and a human performed it. The order is a deterministic consequence.
 *
 * ⚠️ **Zero options is NORMAL, not an error.** "Has a live fulfillment" is false
 * for every order in the database until task 55's re-sync runs, so today this
 * list is empty for everybody. It says so plainly and the return is created
 * without an order rather than blocking on one.
 */
function OrderQuestion({
  label,
  orderOptions,
  isLoading,
  isPending,
  onChooseOrder,
}: {
  label: ReturnIntakeLabel
  orderOptions: ReturnIntakeOrderOption[]
  isLoading: boolean
  isPending: boolean
  onChooseOrder: (orderRecordId: RecordId | null) => void
}) {
  if (isLoading) {
    return <p className='text-muted-foreground text-xs'>Looking for shipped orders&hellip;</p>
  }

  if (orderOptions.length === 0) {
    return (
      <p className='text-muted-foreground text-xs' data-testid={`no-orders-${label.id}`}>
        No shipped order found for this customer, so the return is created without one. Link it
        later from the return itself.
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-1.5' data-testid={`orders-${label.id}`}>
      <span className='text-muted-foreground text-xs'>
        {orderOptions.length === 1
          ? 'One shipped order, already picked. Change it if the parcel is from another.'
          : 'Which order is it from?'}
      </span>
      <ul className='flex flex-wrap gap-1'>
        {orderOptions.map((option) => {
          const picked = label.confirmedOrderRecordId === option.orderRecordId
          return (
            <li key={option.orderRecordId}>
              <Button
                variant={picked ? 'outline' : 'ghost'}
                size='xs'
                disabled={isPending}
                aria-pressed={picked}
                className={cn(picked && 'ring-1 ring-ring')}
                onClick={() => onChooseOrder(picked ? null : option.orderRecordId)}>
                {picked && <Check />}
                {option.orderNumber ?? 'Order'}
              </Button>
            </li>
          )
        })}
        <li>
          <Button
            variant={label.confirmedOrderRecordId === null ? 'outline' : 'ghost'}
            size='xs'
            disabled={isPending}
            aria-pressed={label.confirmedOrderRecordId === null}
            onClick={() => onChooseOrder(null)}>
            No order
          </Button>
        </li>
      </ul>
    </div>
  )
}
