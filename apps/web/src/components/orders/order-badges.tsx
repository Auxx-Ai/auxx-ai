import { Badge } from '@auxx/ui/components/badge'

export const getOrderStatusBadge = (status: string) => {
  switch (status) {
    case 'FULFILLED':
      return <Badge variant='green'>Fulfilled</Badge>
    case 'PARTIALLY_FULFILLED':
      return <Badge variant='yellow'>Partially Fulfilled</Badge>
    case 'UNFULFILLED':
      return <Badge variant='destructive'>Unfulfilled</Badge>
    case 'IN_PROGRESS':
      return <Badge variant='default'>In Progress</Badge>
    case 'PENDING_FULFILLMENT':
      return <Badge variant='secondary'>Pending</Badge>
    default:
      return <Badge variant='outline'>{status}</Badge>
  }
}
