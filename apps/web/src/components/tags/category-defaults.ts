// apps/web/src/components/tags/category-defaults.ts
//
// CLIENT-SAFE mirror of the shipped mail-category definitions
// (plans/mail-filter/06-mail-categories-rework-plan.md §2, seeded by
// `packages/lib/src/seed/ai-category-tags.ts`).
//
// ## Why this is a copy and not an import
//
// The seed module is the single writer of these rows, but it imports
// `@auxx/database` and `UnifiedCrudHandler`, so importing it from the tag dialog
// would pull server-only dependencies into the client bundle (CLAUDE.md,
// "Client vs Server Imports"). `@auxx/lib/seed` has no `/client` subpath today,
// and lib's exports map is generated rather than hand-written — so the honest
// option is a client-safe copy with a DRIFT TEST that reads the seed source and
// asserts every string here still appears in it verbatim
// (`tag-dialog-template-category.test.tsx`). If a `@auxx/lib/seed/client`
// subpath ever lands, delete this map and re-export from there.
//
// ⚠️ These descriptions are PROMPT TEXT, read verbatim by the classifier as the
// label's definition (plan 05 C3). Do not reword, retypeset or "tidy" them here
// — the em dashes and the precedence hints are load-bearing, and a copy that
// drifts makes "Reset to default" write something a fresh seed would not.

/** The shipped definition of one seeded category, keyed by `tag_template_key`. */
export interface TagTemplateDefault {
  /** `tag_template_key` — the shipped identity, stable across renames. */
  templateKey: string
  /** The title the category shipped with. Editable, so it may not be the current one. */
  title: string
  /** The description the category shipped with — the classifier's instruction. */
  description: string
}

/**
 * Every shipped category by `tag_template_key`, including the `Mail Categories`
 * container (which carries a key of its own so it cannot be deleted out from
 * under its children).
 */
export const TAG_TEMPLATE_DEFAULTS: Readonly<Record<string, TagTemplateDefault>> = Object.freeze({
  'category:mail-categories': {
    templateKey: 'category:mail-categories',
    title: 'Mail Categories',
    description:
      'Grouping for the categories the AI classifier may apply to inbound mail. Not applied to mail itself.',
  },
  'category:sales': {
    templateKey: 'category:sales',
    title: 'Sales',
    description:
      'A prospective or existing customer with buying intent: pricing, quotes, availability, product fit, a demo, or expanding an order. Pre-purchase interest, not a problem with something already bought.',
  },
  'category:support': {
    templateKey: 'category:support',
    title: 'Support',
    description:
      'The sender needs help with something they already have: a fault, an error, a how-to question, a return, or a complaint. Something is broken, missing, or not understood.',
  },
  'category:billing': {
    templateKey: 'category:billing',
    title: 'Billing',
    description:
      'Anything about money owed or paid: invoices, charges, refunds, payment methods, subscription fees, failed payments, dunning, receipts and tax documents.',
  },
  'category:account': {
    templateKey: 'category:account',
    title: 'Account',
    description:
      'Access and administration rather than money: sign-in and password problems, user or seat changes, permissions, plan or subscription changes, data export, closing an account.',
  },
  'category:order-status': {
    templateKey: 'category:order-status',
    title: 'Order Status',
    description:
      'Asking where an existing order is, when it ships or arrives, or for tracking. The order exists and the sender wants its state, not a fault and not a change request.',
  },
  'category:returns-refunds': {
    templateKey: 'category:returns-refunds',
    title: 'Returns & Refunds',
    description:
      'Wanting to send something back, cancel an order, or get money back for a completed purchase: returns, exchanges, cancellations, damaged or wrong items.',
  },
  'category:partners-dealers': {
    templateKey: 'category:partners-dealers',
    title: 'Partners & Dealers',
    description:
      'A business wanting to sell, install, distribute or integrate with us: dealer and reseller applications, installer enquiries, affiliate and partnership proposals. A business relationship, not an end-customer purchase.',
  },
})

/**
 * The shipped default for a tag's `tag_template_key`, or undefined for a
 * user-created tag (and for a key this build does not know about — an org seeded
 * by a newer deploy, which must degrade to "ordinary tag", never to a crash).
 */
export function getTagTemplateDefault(
  templateKey: string | null | undefined
): TagTemplateDefault | undefined {
  if (!templateKey) return undefined
  return TAG_TEMPLATE_DEFAULTS[templateKey]
}

/**
 * Why a seeded category has no delete action.
 *
 * `rejectDeleteIfTemplateTag` (`packages/lib/src/field-hooks/pre/tag-template-guard.ts`)
 * throws `ForbiddenError` on any delete of a tag carrying a `tag_template_key`,
 * so any UI that offers one is offering a request that will 403. Stated here
 * once so every surface says the same thing.
 *
 * ⚠️ This is NOT the system-tag treatment. A seeded category stays fully
 * editable — title, emoji, colour, parent and above all the description, which
 * is the classifier's instruction (plan 06 D4 vs D5). Undeletable is the only
 * thing the marker buys.
 */
export const TEMPLATE_TAG_UNDELETABLE_REASON = 'A built-in mail category cannot be deleted.'

/** Does this tag carry a shipped `tag_template_key`, i.e. is it undeletable? */
export function isTemplateTag(tag: { templateKey?: string | null } | null | undefined): boolean {
  return !!tag?.templateKey
}
