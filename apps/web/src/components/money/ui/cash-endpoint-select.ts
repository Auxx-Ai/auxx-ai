// apps/web/src/components/money/ui/cash-endpoint-select.ts

// One select, three shapes: undeposited funds, a bank account, or a payment
// gateway. `api.money.paymentDestinations` supplies the last two.

export interface PaymentDestinations {
  bankAccounts: Array<{ id: string; name: string; last4?: string | null }>
  paymentGateways: Array<{ id: string; name: string }>
}

export const UNDEPOSITED_VALUE = 'undeposited'

/** The select's options, in reading order. `FieldInputAdapter` has no option groups. */
export function cashEndpointOptions(destinations: PaymentDestinations | undefined) {
  return [
    { id: UNDEPOSITED_VALUE, value: UNDEPOSITED_VALUE, label: 'Undeposited funds' },
    ...(destinations?.bankAccounts ?? []).map((account) => ({
      id: `bank:${account.id}`,
      value: `bank:${account.id}`,
      label: account.last4 ? `${account.name} ····${account.last4}` : account.name,
    })),
    ...(destinations?.paymentGateways ?? []).map((gateway) => ({
      id: `gateway:${gateway.id}`,
      value: `gateway:${gateway.id}`,
      label: gateway.name,
    })),
  ]
}

/** The two nullable columns the select's one value stands for. */
export function cashEndpointValueOf(value: string): {
  paymentGatewayId: string | null
  bankAccountInstanceId: string | null
} {
  if (value.startsWith('bank:'))
    return { paymentGatewayId: null, bankAccountInstanceId: value.slice(5) }
  if (value.startsWith('gateway:'))
    return { paymentGatewayId: value.slice(8), bankAccountInstanceId: null }
  return { paymentGatewayId: null, bankAccountInstanceId: null }
}

/** The select value for a movement's stored endpoint — the refund dialog's prefill. */
export function cashEndpointValueFor(source: {
  paymentGatewayId?: string | null
  cashAccountInstanceId?: string | null
}): string {
  if (source.paymentGatewayId) return `gateway:${source.paymentGatewayId}`
  if (source.cashAccountInstanceId) return `bank:${source.cashAccountInstanceId}`
  return UNDEPOSITED_VALUE
}
