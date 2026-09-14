// packages/lib/src/returns/intake/client.ts

// The return-intake contract (plans/money/tasks/57-return-intake-wizard.md):
// every type that crosses between the transcriber, the ladder, the grouper, the
// draft store, the router and the review screen lives here.
//
// ⚠️ No `'use client'` directive — server code imports this file too, and the
// directive would turn every export into a client-reference proxy there
// (docs/lib-module-guide.md §7).
//
// 🔑 The shape this file encodes, and the reason it is one file: the model reads
// pixels into fields and stops. Everything downstream of `TranscribedLabel` is
// deterministic code a test can pin. Nothing in here describes a decision the
// model is allowed to make.

import type { RecordId } from '@auxx/types/resource'

// ── Tiers ────────────────────────────────────────────────────────────────────

/**
 * How a photographed label was matched to a customer.
 *
 * 🛑 The order is strength, and tiers 1–2 resolve an ORDER while tiers 3–4
 * resolve a CONTACT. That asymmetry is the whole reason §0 of the brief was a
 * blocker: `order.shippingAddress` is the only place a ship-to street address is
 * modelled, `contact` has no street or postal field at all, and the address
 * tiers are dark until the `extractValue` fix (§0.4) lands and a re-sync runs.
 *
 * ⚠️ `address` and `address_city` will return NOTHING on a database whose
 * `order_shipping_address` is still empty. That is expected, not a bug, and the
 * ladder must degrade to `name_place` silently rather than refuse.
 */
export const RETURN_INTAKE_TIERS = [
  'address',
  'address_city',
  'name_place',
  'name',
  'none',
] as const
export type ReturnIntakeTier = (typeof RETURN_INTAKE_TIERS)[number]

/**
 * 🛑 **Nothing auto-links. There is deliberately no `isAutoLinkTier` here.**
 *
 * `purchasing/intake/client.ts` has one, because an exact vendor-SKU hit may
 * link a quote line unattended. This brief's owner made the stricter call
 * (§4.4) and the reason is asymmetric risk: a mis-linked quote line shows up as
 * a wrong part on a draft a buyer reads line by line, while a mis-linked return
 * silently attaches one customer's goods to another customer's order — and the
 * over-return guard then computes its ceiling against the wrong order, which is
 * a refusal nobody can explain.
 *
 * The tier is a RANKING and a BADGE. It must never become a branch in a writer.
 */
export const RETURN_INTAKE_TIER_LABELS: Record<ReturnIntakeTier, string> = {
  address: 'Address match',
  address_city: 'Address match',
  name_place: 'Name and city',
  name: 'Name only',
  none: 'No match',
}

/** Ranking weight, highest first. Used only to order candidates on screen. */
export const RETURN_INTAKE_TIER_RANK: Record<ReturnIntakeTier, number> = {
  address: 4,
  address_city: 3,
  name_place: 2,
  name: 1,
  none: 0,
}

// ── What the model transcribes ───────────────────────────────────────────────

/**
 * One return label, as printed.
 *
 * 🛑 **Transcribe, never infer.** The model writes what is on the label. It does
 * not expand `Jon` to `Jonathan`, does not correct a ZIP that looks wrong, and
 * does not guess a carrier from a logo when the name is not printed. A blank
 * field is a fact; a filled-in guess is a fact destroyed.
 *
 * Every field is nullable because every field is genuinely absent on some real
 * label.
 */
export interface TranscribedLabel {
  senderName: string | null
  senderStreet1: string | null
  senderStreet2: string | null
  senderCity: string | null
  senderRegion: string | null
  senderPostalCode: string | null
  senderCountry: string | null

  carrier: string | null
  trackingNumber: string | null

  /** Any RMA or order number written or printed on the label. */
  ourReferenceRaw: string | null

  /**
   * Who the parcel was addressed TO. Read for exactly one purpose (§4.7):
   * catching a worker who photographed an OUTBOUND label. Never a match key.
   */
  recipientNameRaw: string | null

  /**
   * The model's own answer to "could I read this".
   *
   * ⚠️ Not decoration. A crumpled label is a different failure from a clean
   * label with an unknown sender, and the review screen must say which. An
   * illegible label goes to manual entry with the photo beside the fields.
   */
  legible: boolean
}

/** An empty transcription, for a label the model could not read at all. */
export const EMPTY_TRANSCRIBED_LABEL: TranscribedLabel = {
  senderName: null,
  senderStreet1: null,
  senderStreet2: null,
  senderCity: null,
  senderRegion: null,
  senderPostalCode: null,
  senderCountry: null,
  carrier: null,
  trackingNumber: null,
  ourReferenceRaw: null,
  recipientNameRaw: null,
  legible: false,
}

/** Render the transcribed sender block as the raw text `return` stores. */
export function formatSenderAddress(label: TranscribedLabel): string | null {
  const parts = [
    label.senderStreet1,
    label.senderStreet2,
    [label.senderCity, label.senderRegion, label.senderPostalCode]
      .filter((p) => p != null && p.trim() !== '')
      .join(' '),
    label.senderCountry,
  ]
    .map((p) => p?.trim())
    .filter((p): p is string => p != null && p !== '')
  return parts.length > 0 ? parts.join('\n') : null
}

// ── What the ladder produces ─────────────────────────────────────────────────

/**
 * One thing the worker may pick for a label.
 *
 * 🔑 A candidate carries BOTH ids when the tier found them together. An
 * `address` hit names an order and gets its contact for free; a `name_place`
 * hit names a contact and leaves `orderRecordId` null for §4.5 to fill after
 * the worker confirms.
 */
export interface ReturnIntakeCandidate {
  contactRecordId: RecordId
  contactName: string
  /** City / region, for telling two same-named contacts apart on screen. */
  contactPlace: string | null
  /** Present only when the tier resolved an order directly. */
  orderRecordId: RecordId | null
  orderNumber: string | null
  tier: ReturnIntakeTier
}

/** An order the confirmed contact could be returning against (§4.5). */
export interface ReturnIntakeOrderOption {
  orderRecordId: RecordId
  orderNumber: string | null
  /** ISO. The date the order last shipped, for ordering the picker. */
  lastFulfilledAt: string | null
}

// ── One label, through the whole pipeline ────────────────────────────────────

/**
 * A photographed label and everything known about it.
 *
 * The draft holds an array of these. `confirmed*` are the worker's answers and
 * are the ONLY fields the review screen writes.
 */
export interface ReturnIntakeLabel {
  /** Stable within the draft. Ties the photo, the transcription and the answer. */
  id: string
  /** The temp asset ref from the `CUSTOM_FIELD` upload door (§1.2). */
  fileRef: string
  fileName: string

  /** Null until this label's transcribe call returns. */
  transcription: TranscribedLabel | null
  /** Set when the model or the gate refused this one label. */
  error: string | null

  candidates: ReturnIntakeCandidate[]
  bestTier: ReturnIntakeTier

  /**
   * 🛑 Looks like an OUTBOUND label (§4.7): the recipient matches our own
   * business name and the sender does not. A warning on the review screen, never
   * a refusal — a worker may legitimately be returning something to a vendor.
   */
  looksOutbound: boolean

  /** The worker's answers. `null` means not yet decided, not "no match". */
  confirmedContactRecordId: RecordId | null
  confirmedOrderRecordId: RecordId | null
  /**
   * The worker explicitly said this sender is not one of ours (§4.6). Distinct
   * from `confirmedContactRecordId === null`, which only means undecided.
   */
  confirmedUnidentified: boolean
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * One `return` that will be created (§5).
 *
 * 🔑 The group key is `(confirmedContact, confirmedOrder)`. One customer
 * returning against two orders is TWO returns, because the order is the real
 * grain — a return links to one order and its lines come from that order's
 * shipped lines (§5.2).
 *
 * 🛑 Labels that resolved to nothing each become their OWN group. Two
 * unidentified pallets are not one return merely because both are
 * unidentified — that is grouping on the absence of information.
 */
export interface ReturnIntakeGroup {
  /** Stable within the draft, derived from the key. */
  id: string
  contactRecordId: RecordId | null
  orderRecordId: RecordId | null
  /** The labels in this group, in upload order. */
  labelIds: string[]
}

/** Everything the review screen needs to say "3 labels → 2 returns". */
export interface ReturnIntakeGroupView extends ReturnIntakeGroup {
  contactName: string | null
  orderNumber: string | null
  trackingNumbers: string[]
}

// ── The draft ────────────────────────────────────────────────────────────────

export interface ReturnIntakeDraftPayload {
  labels: ReturnIntakeLabel[]
  /**
   * Order options per confirmed contact, filled after confirmation (§4.5).
   * Keyed by `contactRecordId`.
   */
  orderOptions: Record<string, ReturnIntakeOrderOption[]>
}

export const RETURN_INTAKE_DRAFT_STATUSES = ['reading', 'ready', 'failed', 'committed'] as const
export type ReturnIntakeDraftStatus = (typeof RETURN_INTAKE_DRAFT_STATUSES)[number]

/**
 * The read's phases, in order, as the dialog ticks them off.
 *
 * ⚠️ `reading` is n-of-m: one model call per label (§3.1), never one call for
 * all of them. Ten labels in one call would make the model keep ten
 * (image → object) bindings straight, and a single mis-ordering silently assigns
 * one customer's address to another customer's parcel.
 */
export const RETURN_INTAKE_PHASES = ['uploading', 'reading', 'matching', 'ready'] as const
export type ReturnIntakeDraftPhase = (typeof RETURN_INTAKE_PHASES)[number]

export const RETURN_INTAKE_PHASE_LABELS: Record<ReturnIntakeDraftPhase, string> = {
  uploading: 'Uploading the photos',
  reading: 'Reading the labels',
  matching: 'Looking up customers',
  ready: 'Ready to review',
}

/** The draft as the dialog and the review route read it. */
export interface ReturnIntakeDraftView {
  id: string
  status: ReturnIntakeDraftStatus
  phase: ReturnIntakeDraftPhase
  /** `reading` progress. `labelsTotal` is known the moment the upload closes. */
  labelsRead: number
  labelsTotal: number
  /** Set when `status === 'failed'`. Written for a person, not a log. */
  failureReason: string | null
  payload: ReturnIntakeDraftPayload
  createdAt: string
  updatedAt: string
}

// ── Upload ───────────────────────────────────────────────────────────────────

/**
 * What the drop zone takes.
 *
 * Narrower than `return.photos` allows, because these are the formats the
 * transcriber can actually read. ✅ `isSupportedFileMimeType` admits `image/*`
 * and `application/pdf`, and a dock photo is a JPEG or HEIC from a phone — so
 * unlike the vendor-quote path there is NO extractor work here at all.
 *
 * ⚠️ `.heic` is the one to verify against both providers before trusting it
 * (§12 item 2): 38 §11.2 is the cautionary tale of a MIME type the gate admitted
 * and a provider refused, silently, for one provider only.
 */
export const RETURN_LABEL_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf'] as const

/** How many labels one upload may carry. A dock pallet, not a bulk import. */
export const RETURN_INTAKE_MAX_LABELS = 20

// ── Commit ───────────────────────────────────────────────────────────────────

/** What the review screen sends when the worker presses Create. */
export interface ReturnIntakeCommitInput {
  draftId: string
  /** Groups to create. Omitting one leaves it in the draft, uncommitted. */
  groupIds: string[]
}

/**
 * Per-group commit outcome.
 *
 * 🛑 Commit is per group and partial failure is REAL (§6.3). Three groups and
 * the second refuses: the first is already a real RMA with a real number. Each
 * group commits in its own transaction and reports its own result, and the draft
 * keeps the ones that failed so the worker retries those and not the ones that
 * worked. Do NOT wrap all three in one transaction — a dock worker whose third
 * label was unreadable must not lose the two returns that were fine.
 */
export interface ReturnIntakeCommitResult {
  groupId: string
  returnRecordId: RecordId | null
  returnNumber: string | null
  error: string | null
}
