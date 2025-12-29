import React from 'react'
import OrderDetail from '../../_components/order-detail'

type Props = { params: Promise<{ orderId: string }> }

async function OrderDetailPage({ params }: Props) {
  const { orderId } = await params
  return <OrderDetail orderId={orderId} />
}

export default OrderDetailPage
