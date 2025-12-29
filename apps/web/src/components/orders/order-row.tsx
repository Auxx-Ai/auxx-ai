import React from 'react'
import { CardContent } from '@auxx/ui/components/card'
import { getOrderStatusBadge } from './order-badges'
import { type Order } from './types'
import { formatDistanceToNow, format } from 'date-fns'
import { formatCurrency } from '../global/currency'
import { Clock, DollarSign, Package, ShoppingCart } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Badge } from '@auxx/ui/components/badge'

type Props = { order: Order }

function OrderRow({ order }: Props) {
  const router = useRouter()
  const handleViewOrder = (orderId: string) => {
    router.push(`/app/shopify/orders/${orderId}`)
  }

  return (
    <div
      key={order.id.toString()}
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => handleViewOrder(order.id.toString())}>
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex items-center">
            <ShoppingCart className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{order.name}</span>
            <span className="mx-2 text-muted-foreground">-</span>
            <span>{format(new Date(order.createdAt), 'PPP')}</span>
          </div>
          <div className="flex space-x-2">
            {getOrderStatusBadge(order.fulfillmentStatus)}
            <Badge variant="outline">{order.financialStatus}</Badge>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <Package className="mr-1 h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{order.lineItems?.length || 0} items</span>
            </div>
            <div className="flex items-center">
              <DollarSign className="mr-1 h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{formatCurrency(order.totalPrice)}</span>
            </div>
          </div>
          <div className="flex items-center text-sm text-muted-foreground">
            <Clock className="mr-1 h-3 w-3" />
            <span>{formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })}</span>
          </div>
        </div>
      </CardContent>
    </div>
  )
}

export default OrderRow
