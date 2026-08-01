// apps/web/src/components/money/ui/invoice/payment-method-options.ts

// Client-safe mirror of `PAYMENT_METHOD_OPTIONS` (packages/lib/src/resources/registry/
// resources/payment-fields.ts) — that file lives under `resources/registry`, which has no
// `/client` export in packages/lib's package.json, so importing it from client code would
// pull a server-only barrel. Kept in sync by hand (money MI1 build spec §B.2/§J.3); the
// values/labels are the field registry's contract, not derived state.

/** How a payment was collected — mirrors `PAYMENT_METHOD_OPTIONS` server-side. */
export const PAYMENT_METHOD_OPTIONS = [
  { label: 'Cash', value: 'cash', color: 'green' },
  { label: 'Check', value: 'check', color: 'blue' },
  { label: 'Card', value: 'card', color: 'purple' },
  { label: 'Bank transfer', value: 'bank', color: 'teal' },
  { label: 'Other', value: 'other', color: 'gray' },
] as const

export type PaymentMethod = (typeof PAYMENT_METHOD_OPTIONS)[number]['value']

export function paymentMethodLabel(value: string): string {
  return PAYMENT_METHOD_OPTIONS.find((o) => o.value === value)?.label ?? value
}
