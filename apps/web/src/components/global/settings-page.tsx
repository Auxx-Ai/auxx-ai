'use client'

import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@auxx/ui/components/breadcrumb'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'

interface IBradcrumbItem {
  title: string
  href?: string
  loading?: boolean
  loadingWidth?: number
}

type Props = {
  icon?: React.ReactNode
  children: React.ReactNode
  title: string
  description?: string
  breadcrumbs?: IBradcrumbItem[]
  button?: React.ReactNode
  backLink?: string
}

export default function SettingsPage({
  icon,
  children,
  title,
  description,
  breadcrumbs,
  button,
  backLink,
}: Props) {
  breadcrumbs = breadcrumbs || []

  // Track scroll state for shadow effect
  const [isScrolled, setIsScrolled] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // Use Intersection Observer for efficient scroll detection
  useEffect(() => {
    const sentinel = sentinelRef.current
    const viewport = viewportRef.current
    if (!sentinel || !viewport) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        // When sentinel is not intersecting, we've scrolled down
        setIsScrolled(!entry.isIntersecting)
      },
      {
        root: viewport,
        threshold: 1.0, // Trigger when fully visible/hidden
        rootMargin: '0px',
      }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <ScrollArea viewportRef={viewportRef} className='h-full w-full'>
      {breadcrumbs.length > 0 && (
        <header className='w-full flex-none border-b overflow-hidden'>
          <div className='flex items-center gap-2 px-3 py-1.5 no-scrollbar overflow-x-auto'>
            <BreadcrumbList className='gap-1 sm:gap-1 flex-nowrap'>
              {breadcrumbs?.map((breadcrumb, i) => (
                <React.Fragment key={i}>
                  <BreadcrumbItem className='flex-none inline-flex'>
                    {breadcrumb.loading ? (
                      <div className='px-2'>
                        <Skeleton
                          className='h-4'
                          style={{ width: `${breadcrumb.loadingWidth || 100}px` }}
                        />
                      </div>
                    ) : breadcrumb.href ? (
                      <BreadcrumbLink asChild>
                        <Link href={breadcrumb.href} className=' rounded p-1 px-2 hover:bg-muted'>
                          {breadcrumb.title}
                        </Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className='px-2'>{breadcrumb.title}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {i + 1 < breadcrumbs.length && (
                    <BreadcrumbSeparator className='block' key={i + 0.5} />
                  )}
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </div>
        </header>
      )}

      <div className='sticky top-0 z-10 backdrop-blur-sm bg-background/80 rounded-tr-xl'>
        <div
          className={cn('flex flex-col sm:flex-row sm:items-center gap-2 bg-muted/50 px-5 py-3', {
            'ps-2': !!icon,
          })}>
          <div className='flex items-center gap-2'>
            {icon && <div className='flex h-10 w-10 items-center justify-center'>{icon}</div>}
            <div className='me-3'>
              <div className='h3 text-md font-medium'>{title}</div>
              {description && <div className='text-sm text-muted-foreground'>{description}</div>}
            </div>
          </div>
          {button && <div className='sm:ml-auto shrink-0'>{button}</div>}
        </div>
        <Separator className='bg-background' />
        <Separator />
        {/* Shadow that appears on scroll with edge flare */}
        <div
          className={cn(
            'absolute inset-x-0 top-full h-6 pointer-events-none',
            'bg-gradient-to-b from-black/10 via-black/5 to-transparent',
            'mask-radial-from-50% mask-radial-to-100% mask-radial-at-top',
            'transition-opacity duration-500 ease-in-out',
            isScrolled ? 'opacity-100' : 'opacity-0'
          )}
        />
      </div>
      {/* Sentinel element for Intersection Observer */}
      <div ref={sentinelRef} className='h-px shrink-0' aria-hidden='true' />
      {children}
    </ScrollArea>
  )
}
