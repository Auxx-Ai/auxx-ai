// packages/lib/src/returns/status.ts

/**
 * The three closed vocabularies the return records carry, as unions the reads,
 * the writes and the router's zod schemas all narrow against.
 *
 * Declared here rather than imported from the resource registry on purpose:
 * this file is re-exported by `client.ts` and has to stay loadable in a browser
 * bundle, while `resources/registry/resources/return-*-fields.ts` reaches
 * `@auxx/database`. `__tests__/status.test.ts` asserts the two agree exactly,
 * so the duplication cannot drift in silence.
 *
 * 🛑 There is deliberately no money value in {@link ReturnStatus}: status is
 * the PHYSICAL lifecycle only (plan section 3.3) and what was credited is
 * derived from the linked credit memos.
 */

/** `return_status` - where the goods physically are (plan section 3.3). */
export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'in_transit'
  | 'received'
  | 'inspected'
  | 'closed'
  | 'declined'
  | 'cancelled'

/** Every {@link ReturnStatus}, in lifecycle order with the two exits last. */
export const RETURN_STATUSES = [
  'requested',
  'approved',
  'in_transit',
  'received',
  'inspected',
  'closed',
  'declined',
  'cancelled',
] as const satisfies readonly ReturnStatus[]

/** `return_origin` - how the return reached us. Exactly one (plan section 3.4). */
export type ReturnOrigin = 'email' | 'phone' | 'dock' | 'web'

/** Every {@link ReturnOrigin}. */
export const RETURN_ORIGINS = [
  'email',
  'phone',
  'dock',
  'web',
] as const satisfies readonly ReturnOrigin[]

/** `return_line_condition_grade` - the inspector's verdict on the goods. */
export type ReturnLineConditionGrade =
  | 'new_sealed'
  | 'new_open_box'
  | 'used_resalable'
  | 'damaged_repairable'
  | 'damaged_scrap'

/** Every {@link ReturnLineConditionGrade}. */
export const RETURN_LINE_CONDITION_GRADES = [
  'new_sealed',
  'new_open_box',
  'used_resalable',
  'damaged_repairable',
  'damaged_scrap',
] as const satisfies readonly ReturnLineConditionGrade[]

/** `return_line_liability` - whose fault the condition is. The chargeback turns on it. */
export type ReturnLineLiability =
  | 'customer_damage'
  | 'shipping_damage'
  | 'manufacturing_defect'
  | 'wear_and_tear'
  | 'no_fault'
  | 'undetermined'

/** Every {@link ReturnLineLiability}. */
export const RETURN_LINE_LIABILITIES = [
  'customer_damage',
  'shipping_damage',
  'manufacturing_defect',
  'wear_and_tear',
  'no_fault',
  'undetermined',
] as const satisfies readonly ReturnLineLiability[]

/** Narrow a stored `optionId` back to a {@link ReturnStatus}, or null. */
export function toReturnStatus(value: unknown): ReturnStatus | null {
  return RETURN_STATUSES.includes(value as ReturnStatus) ? (value as ReturnStatus) : null
}

/**
 * Is this return still short of an inspection?
 *
 * 🔑 Half of the "credited but not inspected" risk state (plan section 3.3):
 * memos linked while the goods have not been looked at means the money is gone
 * and every bit of leverage in the damage argument went with it. The state is
 * surfaced, never blocked - there are good commercial reasons to refund fast.
 *
 * An exhaustive `switch` rather than a `Set`, deliberately: a set of strings
 * hides a status nobody handled, and this predicate decides whether a return
 * shows a risk badge. The default is unreachable while the union is complete
 * and fails CLOSED - an unknown value is not reported as at risk, because
 * inventing a risk state from a value we do not understand is the worse error.
 */
export function isPreInspectionStatus(status: ReturnStatus): boolean {
  switch (status) {
    case 'requested':
    case 'approved':
    case 'in_transit':
    case 'received':
      return true
    case 'inspected':
    case 'closed':
    case 'declined':
    case 'cancelled':
      return false
    default:
      return false
  }
}

/**
 * The statuses {@link isPreInspectionStatus} answers true for, as a list the
 * list query can put in an `IN (...)`.
 *
 * Derived from the predicate rather than written out again, so the SQL filter
 * and the per-row badge can never disagree about which statuses are at risk.
 */
export const PRE_INSPECTION_RETURN_STATUSES: readonly ReturnStatus[] =
  RETURN_STATUSES.filter(isPreInspectionStatus)
