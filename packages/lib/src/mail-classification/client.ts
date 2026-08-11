// packages/lib/src/mail-classification/client.ts
// CLIENT-SAFE entry point for mail classification — the threshold, the setting
// key, the prompt-shaping constants and the shared label/result types.
// No database, no cache, no queue imports.
//
// NOTE: no 'use client' directive. Server code imports this file too (the guard,
// the classifier and the settings catalog all read these constants), and the
// directive would turn every export into a client-reference proxy there.

/**
 * Minimum model confidence before a tag is applied (plan Q4).
 *
 * Below it the classifier applies NOTHING (C10) — no tag is both the safe state
 * and the correct one, because a mail filter must never act on a guess. Tuned
 * against the `info` line `classify.ts` logs on EVERY call, including the
 * below-threshold ones: there is no column and no audit row, the log IS the
 * tuning data (`scope='mail-classification'` in OpenObserve).
 */
export const MAIL_CLASSIFY_CONFIDENCE_THRESHOLD = 0.7

/**
 * `orgSettings` key holding the ids of the inboxes that opted in (plan §5).
 *
 * A LIST of inbox ids, never a boolean: "classify everything" must not be
 * expressible, because a personal mailbox is its owner's alone and an admin must
 * never be able to switch inference on over someone else's mail (invariant 11).
 */
export const MAIL_CLASSIFICATION_INBOX_IDS_SETTING = 'mailClassificationInboxIds'

/**
 * The `systemAttribute` of the boolean tag field that makes a tag eligible for
 * the classifier's label set (C2). Declared on the `tag` def in
 * `resources/registry/resources/tag-fields.ts`; named here so the server-side
 * lookup and the UI agree on one string.
 */
export const TAG_AI_CLASSIFY_ATTRIBUTE = 'tag_ai_classify'

/**
 * Sentinel enum member meaning "none of these labels fit".
 *
 * The structured output is an enum of tag ids (invariant 12) so the model cannot
 * invent a label — which also means it needs a legal way to decline. A nullable
 * field would work on some providers and not others under `strict`, so the
 * abstention is a member of the same enum. Deliberately not a cuid shape, so it
 * can never collide with a real tag id.
 */
export const MAIL_CLASSIFY_NO_CATEGORY = '__none__'

/**
 * How much `textPlain` reaches the prompt (plan §3.2).
 *
 * The classifier does not need quoted history to decide what a mail is *about*,
 * and truncation is most of the cost control on a per-inbound-message call.
 */
export const MAIL_CLASSIFY_BODY_CHARS = 2000

/**
 * Key under `Message.metadata` holding the classification marker.
 *
 * Its presence IS the "already classified" answer (C9) — classify once per
 * message, ever. A retry that re-infers is a bug the customer sees on an invoice.
 */
export const MAIL_CLASSIFICATION_METADATA_KEY = 'mailClassification'

/** BullMQ job name for the classification worker. */
export const MAIL_CLASSIFICATION_JOB_NAME = 'mailClassificationJob'

/** One eligible tag, as the prompt sees it. */
export interface MailClassificationLabel {
  /** `EntityInstance.id` of the tag — the enum member the model returns. */
  tagId: string
  title: string
  /**
   * `tag_description`. THE definition the model classifies against (C3), not
   * decoration. Null is allowed and deliberate (Q5): a bare title like `Refunds`
   * is often self-explanatory, and silently dropping a tag whose toggle is
   * visibly on is the more confusing failure. The dialog warns instead.
   */
  description: string | null
}

/**
 * Why a message was not classified.
 *
 * The first six arms are guard exits (§3.1) and are entirely normal. The last
 * four are outcomes of the call itself, and they split on ONE question that
 * decides whether the message may ever be classified again:
 *
 * - `'below-threshold'` / `'no-category'` — an inference COMPLETED. The answer
 *   was "apply nothing", which is a decision, and it was paid for. The marker
 *   goes down (C9) and the message is done.
 * - `'no-default-model'` / `'quota-exceeded'` / `'unavailable'` / `'error'` —
 *   nothing ran. `LLMOrchestrator` only meters usage against a response that
 *   came back (`llm-orchestrator.ts`), so a throw means no spend and no
 *   decision. These must NOT stamp the marker, or one transient 429 disqualifies
 *   the message from classification forever.
 *
 * That distinction is carried explicitly by `MailClassificationResult.inferred`
 * rather than re-derived from this union — see the note there.
 */
export type MailClassificationSkipReason =
  | 'machine-mail'
  | 'no-thread'
  | 'inbox-not-opted-in'
  | 'no-eligible-tags'
  | 'already-classified'
  | 'thread-already-categorised'
  | 'no-default-model'
  | 'below-threshold'
  | 'no-category'
  /** Out of AI credits, or over the completions rate limit. Nothing was spent. */
  | 'quota-exceeded'
  /** Provider 429/5xx, network failure or timeout — transient, nothing spent. */
  | 'unavailable'
  /** Anything unexpected. Also unspent, but worth an `error` log rather than a warn. */
  | 'error'

/** The marker written to `Message.metadata.mailClassification` after a call. */
export interface MailClassificationMarker {
  /** ISO timestamp of the inference. */
  at: string
  /** The applied tag id, or null when nothing was applied. */
  tagId: string | null
  confidence: number
  model?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Retroactive re-classification (07-mail-reclassification-plan.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How far back a retroactive run reaches (07 §2.4, axis 1).
 *
 * Presets rather than free-form, because the count preview has to be cheap. The
 * `'threads'` arm is a COUNT of threads rather than a date bound — "just try it
 * on a bit" without thinking about dates — and combines with the always-newest-
 * first ordering (07 invariant 8) to mean "the N most recent threads".
 *
 * Dates are ISO strings, not `Date`s: this shape travels through tRPC input and
 * through BullMQ job data, both of which are JSON, so a `Date` would arrive as a
 * string anyway and only the type would lie.
 */
export type MailReclassifyRange =
  | { kind: 'days'; days: number }
  | { kind: 'threads'; threads: number }
  | { kind: 'custom'; sinceIso: string; untilIso?: string }
  | { kind: 'all-time' }

/** The offered day windows (07 §2.4). */
export const MAIL_RECLASSIFY_DAY_PRESETS = [7, 30, 90] as const

/** The offered thread-count windows (07 §2.4). */
export const MAIL_RECLASSIFY_THREAD_PRESETS = [100, 500, 1000] as const

/**
 * Default range: the last 30 days (07 R-Q1).
 *
 * A cost decision, not a correctness one — under R5 a label on 2021 mail has
 * full analytical value, so "all time" stays available behind a confirm.
 */
export const MAIL_RECLASSIFY_DEFAULT_RANGE: MailReclassifyRange = { kind: 'days', days: 30 }

/**
 * What state of thread a run is pointed at (07 §2.4, axis 2 / R4).
 *
 * ⚠️ Two genuinely different operations with different cost profiles, and the UI
 * must not blur them:
 *
 * - `'fill-gaps'` — threads whose first inbound message carries **no** marker.
 *   Pays once, for mail that never reached the classifier at all. THE DEFAULT.
 * - `'re-classify'` — everything in scope, marker or not. Bypasses guard exit 5
 *   and therefore **pays again** for mail already classified. The taxonomy-change
 *   case, and the only way a user can accidentally spend twice.
 */
export type MailReclassifyMode = 'fill-gaps' | 're-classify'

/** 07 R4 — fill-gaps is the default because it can never double-bill. */
export const MAIL_RECLASSIFY_DEFAULT_MODE: MailReclassifyMode = 'fill-gaps'

/**
 * Do two requests describe the same run?
 *
 * ⚠️ Exists because the sample's BullMQ `jobId` is keyed on **(org, inbox) only**,
 * so a second start while one is in flight collapses into the running job no
 * matter what scope was asked for. That collapse is right for a double-click and
 * wrong for a changed scope: the caller believes it started the run it described,
 * and would carry on to record it. The router compares here and refuses the
 * mismatch rather than silently running something else.
 *
 * Field-by-field per arm, not `JSON.stringify` — the two objects travel through
 * tRPC input and BullMQ job data independently, and jsonb/JSON round-trips do not
 * promise key order.
 */
export function isSameReclassifyScope(
  a: { range: MailReclassifyRange; mode: MailReclassifyMode },
  b: { range: MailReclassifyRange; mode: MailReclassifyMode }
): boolean {
  if (a.mode !== b.mode) return false
  const x = a.range
  const y = b.range
  if (x.kind !== y.kind) return false
  switch (x.kind) {
    case 'days':
      return x.days === (y as { kind: 'days'; days: number }).days
    case 'threads':
      return x.threads === (y as { kind: 'threads'; threads: number }).threads
    case 'custom': {
      const other = y as { kind: 'custom'; sinceIso: string; untilIso?: string }
      return x.sinceIso === other.sinceIso && x.untilIso === other.untilIso
    }
    case 'all-time':
      return true
  }
}

/**
 * Hard ceiling on threads ONE run may touch (07 §2.5, R-Q4).
 *
 * ⚠️ Reaching it is reported, never a silent truncate (07 invariant 8) — a capped
 * run says what it capped, because silent truncation reads as "covered
 * everything".
 */
export const MAIL_RECLASSIFY_MAX_THREADS = 5000

/**
 * Ceiling for the backlog count shown on the classification card (07 R-Q5).
 *
 * Past it the UI renders `1,000+`: it is an order of magnitude for a decision,
 * not a billing figure, and an exact count over a large mailbox is a slow query.
 */
export const MAIL_RECLASSIFY_BACKLOG_COUNT_CAP = 1000

/** Threads one sample classifies (07 §2.11, R-Q2). Re-sample rather than resize. */
export const MAIL_RECLASSIFY_SAMPLE_SIZE = 100

/** BullMQ job name for the sample run. Registered on `maintenanceQueue`. */
export const MAIL_RECLASSIFY_SAMPLE_JOB_NAME = 'mailReclassifySampleJob'

/** One label's share of a sample (07 §2.11, §3.3). */
export interface MailReclassifySampleLabelStat {
  tagId: string
  title: string
  /** Threads the model assigned this label, at or above the threshold. */
  count: number
  /**
   * Mean confidence across those threads, or 0 when `count` is 0.
   *
   * A label with consistently low confidence is overlapping another (07 §2.11).
   */
  meanConfidence: number
}

/**
 * What a sample run reports (07 §2.11).
 *
 * ⚠️ It applies NOTHING and writes NO marker (07 invariant 9) — `applied` is a
 * literal `false` so a future change that starts persisting has to change the
 * type rather than quietly change behaviour.
 */
export interface MailReclassifySampleReport {
  inboxId: string
  mode: MailReclassifyMode
  /** Threads asked for — {@link MAIL_RECLASSIFY_SAMPLE_SIZE} unless overridden. */
  requested: number
  /** Threads the scope actually yielded. May be < `requested`. */
  selected: number
  /**
   * Threads a model call COMPLETED for. Guard exits and provider failures reduce
   * it below `selected`, and 07 §2.11 requires saying so rather than implying
   * the full sample size.
   */
  inferred: number
  /** Threads that produced a label at or above the confidence threshold. */
  classified: number
  /**
   * Completed inferences that applied nothing.
   *
   * **The single most informative number** (07 §2.11): high abstention means the
   * vocabulary does not fit this mail, or the threshold is wrong. Rendered as its
   * own row, never hidden (07 §3.3).
   */
  abstained: number
  /** `abstained / inferred`, or 0 when nothing was inferred. */
  abstentionRate: number
  /** Mean confidence over every completed inference, abstentions included. */
  meanConfidence: number
  /**
   * Every eligible label, **including the ones never chosen**. A zero row is the
   * finding (07 §3.3 / 06 Q1: a label never chosen is a label to merge), so it
   * must render rather than be filtered out.
   */
  labels: MailReclassifySampleLabelStat[]
  /**
   * Threads that never reached a model call, keyed by guard/failure reason.
   *
   * Guard exits and provider failures both land here, and they mean different
   * things: an exit is normal, a `'quota-exceeded'` or `'unavailable'` means the
   * sample is smaller than it looks for a reason worth showing.
   */
  skipped: Partial<Record<MailClassificationSkipReason, number>>
  /**
   * Why the completed inferences applied nothing — `'no-category'` (the model
   * declined) versus `'below-threshold'` (it picked one but was not confident).
   *
   * Kept apart from `skipped` because these DID cost an inference, and because
   * the split is what says whether the vocabulary is wrong or the threshold is.
   */
  abstainedByReason: Partial<Record<MailClassificationSkipReason, number>>
  /** ⚠️ Always false. Sample mode persists nothing (07 invariant 9). */
  applied: false
}

/** Lifecycle of an enqueued sample, as the dialog polls it. */
export interface MailReclassifySampleStatus {
  jobId: string
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown'
  /** Threads processed so far, when the job has reported progress. */
  processed: number
  /** Threads the job intends to process. */
  total: number
  /** Present once `state === 'completed'`. */
  report?: MailReclassifySampleReport
}
