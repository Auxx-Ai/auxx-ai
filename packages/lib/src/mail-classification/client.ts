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
 * Why a message was not classified. Every arm is a guard exit (§3.1) except
 * `'error'`; all of them are normal, and none of them is a failure the caller
 * should retry.
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
