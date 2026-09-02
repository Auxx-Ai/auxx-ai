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
import type { LucideIcon } from 'lucide-react'
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
  title: React.ReactNode
  description?: React.ReactNode
  breadcrumbs?: IBradcrumbItem[]
  button?: React.ReactNode
  /**
   * Optional row rendered inside the sticky header, below the title (e.g. a
   * tab strip). Keeping it in the same sticky block avoids a second sticky bar
   * with a hardcoded top offset that can overlap the header on tall layouts.
   */
  subHeader?: React.ReactNode
  /**
   * Override classes on the sub-header wrapper. Defaults to a padded row
   * (`px-3 py-2.5`) suited to pill tabs; pass `p-0` for a flush, full-width
   * strip (e.g. an underlined `TabsList variant='outline'`).
   */
  subHeaderClassName?: string
  /**
   * The breakpoint from which `button` sits beside the title instead of below
   * it. Defaults to `lg`: beside a button, a description of any length wraps
   * into several lines at tablet widths. Lower it for a page whose description
   * is a few words.
   */
  buttonBreakpoint?: 'sm' | 'md' | 'lg'
  backLink?: string
}

/**
 * Static class strings per breakpoint: Tailwind only ships classes it can see in
 * source, so the variant cannot be built from the prop at runtime.
 */
const HEADER_ROW_AT = {
  sm: { row: 'sm:flex-row sm:items-center sm:pe-5', button: 'sm:ml-auto' },
  md: { row: 'md:flex-row md:items-center md:pe-5', button: 'md:ml-auto' },
  lg: { row: 'lg:flex-row lg:items-center lg:pe-5', button: 'lg:ml-auto' },
} as const

export default function SettingsPage({
  icon,
  children,
  title,
  description,
  breadcrumbs,
  button,
  subHeader,
  subHeaderClassName,
  buttonBreakpoint = 'lg',
  backLink,
}: Props) {
  const headerRow = HEADER_ROW_AT[buttonBreakpoint]
  breadcrumbs = breadcrumbs || []

  // Track scroll state for shadow effect
  const [isScrolled, setIsScrolled] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stickyHeaderRef = useRef<HTMLDivElement>(null)

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

  /**
   * Publish the sticky header's height, and the viewport's, as CSS variables on
   * the scroll viewport.
   *
   * A page that wants a sticky side pane needs to know how far down to pin it,
   * and that distance is NOT a constant: the header block below is title +
   * optional description + optional `subHeader` + separator, so it differs per
   * page and changes when a tab strip is added. Hardcoding a pixel value works
   * on the page it was measured on and is quietly wrong on the next one.
   *
   * Measuring it here rather than in each page is the point — `SettingsPage`
   * owns the sticky block, so it is the only thing that can answer this
   * correctly, and every page opts in with one class:
   *
   *     lg:sticky lg:top-[var(--settings-sticky-top)]
   *
   * ⚠️ `--settings-viewport-h` is the SCROLL VIEWPORT's height, not the
   * window's. This ScrollArea is nested inside a panel frame with its own
   * insets, so `100dvh` overshoots by the chrome above and below it and a pane
   * capped that way would run off the bottom.
   */
  useEffect(() => {
    const header = stickyHeaderRef.current
    const viewport = viewportRef.current
    if (!header || !viewport) return

    const publish = () => {
      viewport.style.setProperty('--settings-sticky-top', `${header.offsetHeight}px`)
      viewport.style.setProperty('--settings-viewport-h', `${viewport.clientHeight}px`)
    }

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(header)
    observer.observe(viewport)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    // noFade: the sticky FormSaveBar sits at the viewport bottom — the edge fade would mask it.
    <ScrollArea
      viewportRef={viewportRef}
      noFade
      className='h-full w-full'
      scrollbarClassName='z-21'>
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

      <div
        ref={stickyHeaderRef}
        className='sticky top-0 z-20 backdrop-blur-sm bg-background/80 rounded-tr-xl'>
        <div
          className={cn('flex flex-col gap-2 bg-muted/50 px-5 py-3 pe-2', headerRow.row, {
            'ps-2': !!icon,
          })}>
          <div className='flex items-center gap-2'>
            {icon && <div className='flex h-10 w-10 items-center justify-center'>{icon}</div>}
            <div className='me-3'>
              <div className='h3 text-md font-medium'>{title}</div>
              {description && <div className='text-sm text-muted-foreground'>{description}</div>}
            </div>
          </div>
          {button && <div className={cn('shrink-0', headerRow.button)}>{button}</div>}
        </div>
        {subHeader && (
          <div className={cn('border-t bg-background/60 px-3 py-2.5', subHeaderClassName)}>
            {subHeader}
          </div>
        )}
        {/* <Separator className='bg-background' /> */}
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

type SettingsSectionProps = {
  /**
   * Section icon. From client components pass a bare lucide icon (icon={Globe}); the
   * component renders it as <Icon className='size-4' />. From server components pass a
   * rendered element (icon={<Globe className='size-4' />}) — component references can't
   * cross the server/client boundary.
   */
  icon?: LucideIcon | React.ReactNode
  /** ReactNode so the title can include inline badges, counts, etc. */
  title: React.ReactNode
  /** Optional supporting copy under the title. */
  description?: React.ReactNode
  /** Optional right-aligned action (button/link/dropdown). */
  action?: React.ReactNode
  /** Section body. */
  children?: React.ReactNode
  /** Override classes on the root wrapper. */
  className?: string
}

/** Render the icon prop: a rendered element passes through; a bare component gets sized. */
function renderSectionIcon(icon: SettingsSectionProps['icon']) {
  if (!icon) return null
  if (React.isValidElement(icon)) return icon
  const Icon = icon as LucideIcon
  return <Icon className='size-4' />
}

/**
 * A settings section: a titled header (icon + title + optional description/action)
 * bound to its content. Pairs with {@link SettingsPage} — where SettingsPage wraps a
 * page, SettingsSection wraps one section within it. The `section-header` and
 * `section-content` data-slots are exposed for later styling/behavior overrides.
 */
export function SettingsSection({
  icon,
  title,
  description,
  action,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div data-slot='section-header' className='space-y-1'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
            {renderSectionIcon(icon)}
            {title}
          </div>
          {action && <div className='shrink-0'>{action}</div>}
        </div>
        {description && <p className='text-sm text-muted-foreground'>{description}</p>}
      </div>
      {/* space-y-4 stacks multiple content children; a no-op when content is a single wrapper. */}
      {children && (
        <div data-slot='section-content' className='space-y-4'>
          {children}
        </div>
      )}
    </div>
  )
}
