'use client'

import * as React from 'react'
import {
  ChevronRight,
  ShoppingBag,
  User,
  Package,
  Truck,
  RefreshCw,
  Ticket,
  FileText,
  X,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useQueryState } from 'nuqs'

import { OrderProvider, useOrder } from './order-context'
import OrderSummary from '../../app/(protected)/app/shopify/_components/order-summary'
import OrderCustomer from '../../app/(protected)/app/shopify/_components/order-customer'
import OrderLineItems from '../../app/(protected)/app/shopify/_components/order-line-items'
import OrderFulfillments from '../../app/(protected)/app/shopify/_components/order-fulfillments'
import OrderRefunds from '../../app/(protected)/app/shopify/_components/order-refunds'
import OrderTickets from '../../app/(protected)/app/shopify/_components/order-tickets'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { Tooltip } from '~/components/global/tooltip'

// Memoized tab content components for performance
const MemoOrderSummary = React.memo(OrderSummary)
const MemoOrderCustomer = React.memo(OrderCustomer)
const MemoOrderLineItems = React.memo(OrderLineItems)
const MemoOrderFulfillments = React.memo(OrderFulfillments)
const MemoOrderRefunds = React.memo(OrderRefunds)
const MemoOrderTickets = React.memo(OrderTickets)

interface OrderDrawerProps {
  /** Whether the drawer is open (for controlled usage) */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** The order ID to display */
  orderId: string | null
}

/**
 * OrderDrawer component that displays order information in a right-side sliding drawer.
 * Supports both overlay and docked modes.
 */
export function OrderDrawer({ open, onOpenChange, orderId }: OrderDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  /** Handle close button click */
  const handleClose = React.useCallback(() => {
    onOpenChange?.(false)
  }, [onOpenChange])

  if (!open || !orderId) return null

  return (
    <OrderProvider orderId={orderId} enabled={!!open && !!orderId}>
      <DockableDrawer
        open={open}
        onOpenChange={onOpenChange ?? (() => {})}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={800}
        title="Order">
        <OrderDrawerHeader onClose={handleClose} />
        <OrderDrawerContent />
      </DockableDrawer>
    </OrderProvider>
  )
}

/**
 * Header section of the order drawer
 */
function OrderDrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center font-normal justify-between h-[53px] border-b bg-black/5 dark:bg-black/80 px-1">
      <div className="flex items-center space-x-2">
        <Button variant="outline" size="sm" className="w-7 h-7 p-0" onClick={onClose}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="text-sm">Order</div>
      </div>
      <div className="flex items-center space-x-2">
        <DockToggleButton />
        <Tooltip content="Close">
          <Button variant="outline" size="sm" className="rounded-full w-7 h-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * Main content area of the order drawer
 */
function OrderDrawerContent() {
  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'summary' })

  return (
    <div className="flex-1 overflow-y-auto">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full">
        <div className="w-full h-full flex gap-0">
          <div className="w-full h-full flex flex-col overflow-auto justify-start">
            <OrderDrawerTabs />
            <OrderDrawerInfo />
            <div className="flex flex-1 overflow-hidden">
              <TabsContent value="summary" className="w-full">
                <MemoOrderSummary />
              </TabsContent>
              <TabsContent value="customer" className="w-full">
                <MemoOrderCustomer />
              </TabsContent>
              <TabsContent value="items" className="w-full">
                <MemoOrderLineItems />
              </TabsContent>
              <TabsContent value="fulfillments" className="w-full">
                <MemoOrderFulfillments />
              </TabsContent>
              <TabsContent value="refunds" className="w-full">
                <MemoOrderRefunds />
              </TabsContent>
              <TabsContent value="tickets" className="w-full">
                <MemoOrderTickets />
              </TabsContent>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  )
}

/**
 * Tabs navigation section
 */
function OrderDrawerTabs() {
  return (
    <div className="w-full border-b overflow-hidden">
      <TabsList className="text-foreground justify-start mb-0 h-auto gap-2 rounded-none bg-transparent px-0 py-1 overflow-x-auto no-scrollbar w-full">
        <TabsTrigger value="summary" variant="outline">
          <FileText className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
          Summary
        </TabsTrigger>
        <TabsTrigger value="customer" variant="outline">
          <User className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
          Customer
        </TabsTrigger>
        <TabsTrigger value="items" variant="outline">
          <Package className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
          Items
        </TabsTrigger>
        <TabsTrigger value="fulfillments" variant="outline">
          <Truck className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
          Fulfillments
        </TabsTrigger>
        <TabsTrigger value="refunds" variant="outline">
          <RefreshCw className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
          Refunds
        </TabsTrigger>
        <TabsTrigger value="tickets" variant="outline">
          <Ticket className="-ms-0.5 me-1.5 opacity-60" size={16} aria-hidden="true" />
          Tickets
        </TabsTrigger>
      </TabsList>
    </div>
  )
}

/**
 * Order information section (name and creation date)
 */
function OrderDrawerInfo() {
  const { order, isLoading } = useOrder()

  // Memoize the formatted date to avoid recalculating on every render
  const formattedDate = React.useMemo(() => {
    if (!order?.createdAt) return null
    return formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })
  }, [order?.createdAt])

  return (
    <div className="flex gap-3 pb-2 px-3 pt-0 h-[77px] flex-row items-center justify-start border-b">
      <div className="h-[40px] w-[40px] bg-neutral-200 dark:bg-neutral-800 rounded-sm flex items-center justify-center">
        <ShoppingBag className="h-4 w-4 text-neutral-500 dark:text-foreground" />
      </div>
      <div className="flex flex-col align-start w-full gap-1">
        <div className="text-lg font-medium text-neutral-900 dark:text-neutral-400 truncate">
          {isLoading ? <Skeleton className="h-7 w-80" /> : order?.name || 'Unknown Order'}
        </div>
        <div className="text-xs text-neutral-500 truncate">
          {isLoading ? (
            <Skeleton className="h-4 w-40" />
          ) : formattedDate ? (
            `Created ${formattedDate}`
          ) : (
            'Unknown date'
          )}
        </div>
      </div>
    </div>
  )
}

