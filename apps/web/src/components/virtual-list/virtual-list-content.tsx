// apps/web/src/components/virtual-list/virtual-list-content.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Loader2 } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'
import { useVirtualListContext } from './virtual-list'

/**
 * Props for the VirtualListContent component
 */
interface VirtualListContentProps {
  className?: string
  children: ReactNode
  emptyMessage?: string
  loadingMessage?: string
}

/**
 * Content wrapper for VirtualList with loading and empty states
 */
export function VirtualListContent({
  className,
  children,
  emptyMessage = 'No items found',
  loadingMessage = 'Loading...',
}: VirtualListContentProps) {
  const { items, isLoading, hasMore, onLoadMore, virtualizer, scrollContainerRef } =
    useVirtualListContext()
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [onLoadMore, hasMore, isLoading])

  if (isLoading && items.length === 0) {
    return (
      <div className='flex items-center justify-center py-8 flex-1'>
        <Loader2 className='size-6 animate-spin mr-2' />
        <span className='text-muted-foreground'>{loadingMessage}</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className='text-center py-8 text-muted-foreground flex-1 flex items-center justify-center'>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div ref={scrollContainerRef} className={cn('flex-1 ', className)}>
      {virtualizer ? (
        <div
          data-slot='virtual-list-content'
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}>
          {children}
        </div>
      ) : (
        children
      )}

      {/* Load more trigger */}
      {hasMore && (
        <div ref={loadMoreRef} className='py-4 text-center'>
          {isLoading && (
            <div className='flex items-center justify-center'>
              <Loader2 className='h-4 w-4 animate-spin mr-2' />
              <span className='text-sm text-muted-foreground'>Loading more...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Props for the VirtualListItems component
 */
interface VirtualListItemsProps<T> {
  renderItem: (item: T, index: number, style?: CSSProperties) => ReactNode
  getItemId: (item: T) => string
}

/**
 * Component to render virtualized list items
 */
export function VirtualListItems<T>({ renderItem, getItemId }: VirtualListItemsProps<T>) {
  const { items, virtualizer } = useVirtualListContext<T>()
  const observersRef = useRef<Map<string, ResizeObserver>>(new Map())

  // Cleanup observers on unmount
  useEffect(() => {
    return () => {
      observersRef.current.forEach((observer) => observer.disconnect())
      observersRef.current.clear()
    }
  }, [])

  if (!virtualizer) {
    // Fallback to regular list if virtualizer not available
    return (
      <>
        {items.map((item, index) => (
          <div key={getItemId(item)}>{renderItem(item, index)}</div>
        ))}
      </>
    )
  }

  return (
    <>
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index]
        if (!item) return null

        const isFirst = virtualItem.index === 0
        const isLast = virtualItem.index === items.length - 1

        return (
          <div
            data-slot='virtual-list-item'
            key={virtualItem.key}
            data-index={virtualItem.index}
            data-first={isFirst || undefined}
            data-last={isLast || undefined}
            ref={(node) => {
              // Handle node removal
              if (!node) {
                const observer = observersRef.current.get(String(virtualItem.key))
                if (observer) {
                  observer.disconnect()
                  observersRef.current.delete(String(virtualItem.key))
                }
                return
              }

              // Call virtualizer's measureElement
              virtualizer.measureElement(node)

              // Set up ResizeObserver if supported
              if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
                // Clean up existing observer
                const existingObserver = observersRef.current.get(String(virtualItem.key))
                if (existingObserver) {
                  existingObserver.disconnect()
                }

                // Create new observer
                const resizeObserver = new ResizeObserver((entries) => {
                  // Trigger remeasurement on resize
                  if (entries[0] && node.isConnected) {
                    // Force the virtualizer to remeasure this element
                    virtualizer.measureElement(node)
                  }
                })

                resizeObserver.observe(node)
                observersRef.current.set(String(virtualItem.key), resizeObserver)
              }
            }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}>
            {renderItem(item, virtualItem.index)}
          </div>
        )
      })}
    </>
  )
}
