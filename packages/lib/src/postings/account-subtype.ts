// packages/lib/src/postings/account-subtype.ts
//
// The `gl_account.subtype` vocabulary as a literal union and a tuple, derived
// from `GlAccountSubtype`'s NAMED members for the reason `default-chart.ts`
// gives for `GlAccountTypeValue`: `satisfies FieldOptionItem[]` widens
// `value` to `string`, so a type built from `values` would let a chart carry
// `subtype: 'nonsense'`. PURE DATA, client-safe.

import { GlAccountSubtype } from '../resources/registry/enum-values'

/** One of the eight subtypes, as a literal. */
export type GlAccountSubtypeValue = (typeof GlAccountSubtype)[Exclude<
  keyof typeof GlAccountSubtype,
  'values'
>]

/** The eight subtypes as a non-empty tuple, for a `z.enum`. */
export const GL_ACCOUNT_SUBTYPES = [
  GlAccountSubtype.BANK,
  GlAccountSubtype.ACCOUNTS_RECEIVABLE,
  GlAccountSubtype.ACCOUNTS_PAYABLE,
  GlAccountSubtype.CREDIT_CARD,
  GlAccountSubtype.INVENTORY,
  GlAccountSubtype.FIXED_ASSET,
  GlAccountSubtype.COST_OF_GOODS_SOLD,
  GlAccountSubtype.OTHER,
] as const satisfies readonly GlAccountSubtypeValue[]

/** `'Cost of goods sold'`, for a select and a sentence. */
export function accountSubtypeLabel(subtype: GlAccountSubtypeValue): string {
  return GlAccountSubtype.values.find((option) => option.value === subtype)?.label ?? subtype
}
