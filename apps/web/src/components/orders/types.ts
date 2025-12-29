// apps/web/src/components/orders/types.ts
import type { RouterOutputs } from '~/trpc/react'

// Represents an order that is guaranteed to exist from order.byId.
export type Order = NonNullable<RouterOutputs['order']['byId']>
