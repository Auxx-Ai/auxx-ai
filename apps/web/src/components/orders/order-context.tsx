'use client'

import * as React from 'react'
import { api } from '~/trpc/react'

// Types for the order (based on what's returned from tRPC)
type Order = {
  id: bigint
  name: string
  createdAt: Date | null
  // Add other order properties as needed based on your schema
}

interface OrderContextValue {
  /** The current order data */
  order: Order | null
  /** Whether the order is currently loading */
  isLoading: boolean
  /** Any error that occurred while fetching the order */
  error: any | null
  /** Refetch the order data */
  refetch: () => void
}

const OrderContext = React.createContext<OrderContextValue | null>(null)

interface OrderProviderProps {
  /** The order ID to fetch */
  orderId: string
  /** Child components */
  children: React.ReactNode
  /** Whether to enable the query (useful for conditional fetching) */
  enabled?: boolean
}

/**
 * OrderProvider component that fetches and provides order data to its children
 */
export function OrderProvider({ orderId, children, enabled = true }: OrderProviderProps) {
  const {
    data: order,
    isLoading,
    error,
    refetch,
  } = api.order.byId.useQuery(
    { id: orderId },
    {
      enabled: enabled && !!orderId,
      // Optional: add stale time to reduce refetches
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  )

  const contextValue = React.useMemo(
    (): OrderContextValue => ({ order: order || null, isLoading, error: error || null, refetch }),
    [order, isLoading, error, refetch]
  )

  return <OrderContext.Provider value={contextValue}>{children}</OrderContext.Provider>
}

/**
 * Hook to access the order context
 * @returns The order context value
 * @throws Error if used outside of OrderProvider
 */
export function useOrder(): OrderContextValue {
  const context = React.useContext(OrderContext)

  if (!context) {
    throw new Error('useOrder must be used within an OrderProvider')
  }

  return context
}

/**
 * Hook to get just the order data (convenience hook)
 * @returns The order data or null
 */
export function useOrderData() {
  const { order } = useOrder()
  return order
}

/**
 * Hook to get the order loading state (convenience hook)
 * @returns Whether the order is loading
 */
export function useOrderLoading() {
  const { isLoading } = useOrder()
  return isLoading
}

/**
 * Hook to get the order error state (convenience hook)
 * @returns The order error or null
 */
export function useOrderError() {
  const { error } = useOrder()
  return error
}
