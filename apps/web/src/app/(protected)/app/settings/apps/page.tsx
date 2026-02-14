'use client'
import { constants } from '@auxx/config/client'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  BarChart3,
  Bot,
  ClipboardList,
  CreditCard,
  Globe,
  Headphones,
  MessageSquare,
  Package,
  Phone,
} from 'lucide-react'
import Link from 'next/link'
// ~/app/(protected)/app/settings/integrations/_components/integration-list.tsx
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppListCard } from '~/components/apps/app-list-card'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/react'

/** Icon mapping for app categories */
const iconMap = {
  BarChart3,
  Bot,
  CreditCard,
  Phone,
  Headphones,
  MessageSquare,
  ClipboardList,
  Package,
} as const

/** Flag to control whether to show empty categories */
const SHOW_EMPTY_CATEGORIES = true

/**
 * IntegrationList component
 * Displays a list of integrations and provides functionality to manage them
 */
export default function IntegrationList() {
  const { data: results } = api.apps.list.useQuery({})
  const { data: installedResult } = api.apps.listInstalled.useQuery({
    // type filter is optional - omitting it returns all installations (both dev and production)
  })
  const installed = installedResult?.installations ?? []
  const apps = results?.apps ?? []

  // Search state
  const [searchQuery, setSearchQuery] = useState('')

  // Filter apps based on search query
  const filteredApps = apps.filter((app) => {
    if (!searchQuery.trim()) return true

    const query = searchQuery.toLowerCase()
    return (
      app.title.toLowerCase().includes(query) ||
      app.description?.toLowerCase().includes(query) ||
      app.category?.toLowerCase().includes(query) ||
      app.developerAccount.title.toLowerCase().includes(query)
    )
  })

  // Get first 3 installed apps with full app data
  const installedAppsToShow = installed
    .slice(0, 3)
    .map((installation) => {
      const fullApp = apps.find((app) => app.slug === installation.app.slug)
      return fullApp ? { app: fullApp, installation } : null
    })
    .filter(
      (item): item is { app: (typeof apps)[0]; installation: (typeof installed)[0] } =>
        item !== null
    )

  const hasMoreInstalled = installed.length > 3

  // Group apps by category (using filtered apps)
  const appsByCategory = filteredApps.reduce(
    (acc, app) => {
      const category = app.category || 'uncategorized'
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(app)
      return acc
    },
    {} as Record<string, typeof filteredApps>
  )

  // Build list of all categories to display
  const allCategories = [
    ...constants.appCategories,
    { value: 'uncategorized', label: 'Uncategorized', icon: 'Package' },
  ]

  // Filter categories based on whether they have apps
  const categoriesToDisplay = SHOW_EMPTY_CATEGORIES
    ? allCategories
    : allCategories.filter((cat) => appsByCategory[cat.value]?.length > 0)

  // Create refs for each category section
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // Track active category based on scroll position
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // Scroll to category section
  const scrollToCategory = (categoryValue: string) => {
    const section = sectionRefs.current[categoryValue]
    if (section) {
      const scrollContainer = document.querySelector('[data-slot="settings-page"]')
      if (scrollContainer) {
        const rect = section.getBoundingClientRect()
        const scrollTop = scrollContainer.scrollTop
        const offset = 130 // Account for sticky header (80px) + input field (40px) + spacing (10px)

        scrollContainer.scrollTo({
          top: scrollTop + rect.top - offset,
          behavior: 'smooth',
        })
      } else {
        // Fallback
        section.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }

  // Track scroll position to update active category using IntersectionObserver
  useLayoutEffect(() => {
    let observer: IntersectionObserver | null = null
    let updateTimeout: NodeJS.Timeout | null = null
    let lastCategory: string | null = null

    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      // Create IntersectionObserver - no root means it observes relative to viewport
      observer = new IntersectionObserver(
        (entries) => {
          // Debounce updates to prevent rapid changes
          if (updateTimeout) {
            clearTimeout(updateTimeout)
          }

          updateTimeout = setTimeout(() => {
            // Check all sections, not just the ones in entries
            let bestCategory: string | null = null
            const stickyHeaderOffset = 80 // pt-20 = 5rem = 80px
            const inputFieldHeight = 40 // Input field height
            const spacing = 10 // Additional spacing
            const activationPoint = stickyHeaderOffset + inputFieldHeight + spacing + 20 // 150px total with 20px buffer

            // Loop through categories in order and find the LAST one that has passed the activation point
            for (const category of categoriesToDisplay) {
              const section = sectionRefs.current[category.value]
              if (section) {
                const rect = section.getBoundingClientRect()

                // If this section's top has crossed the activation point and the section is still visible
                if (rect.top <= activationPoint && rect.bottom > 0) {
                  bestCategory = category.value
                  // Don't break - keep looping to find the LAST section that meets this criteria
                }
              }
            }

            // Only update if the category actually changed
            if (bestCategory && bestCategory !== lastCategory) {
              lastCategory = bestCategory
              setActiveCategory(bestCategory)
            }
          }, 100) // 100ms debounce
        },
        {
          // No root - observe relative to viewport
          rootMargin: '0px',
          threshold: [0, 0.25, 0.5, 0.75, 1.0],
        }
      )

      // Observe all category sections
      for (const category of categoriesToDisplay) {
        const section = sectionRefs.current[category.value]
        if (section) {
          observer.observe(section)
        }
      }
    }, 50) // Small delay to ensure DOM is ready

    // Cleanup
    return () => {
      clearTimeout(timeoutId)
      if (updateTimeout) {
        clearTimeout(updateTimeout)
      }
      if (observer) {
        observer.disconnect()
      }
    }
  }, [categoriesToDisplay]) // Re-run when categories change
  return (
    <SettingsPage
      title='Marketplace'
      description='Manage your external service integrations for email, messaging, and telephony'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Apps' }]}
      button={<></>}>
      <div className='flex flex-col flex-1 p-6 space-y-8'>
        <div className='space-y-2'>
          <div className='flex items-center justify-between gap-2'>
            <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
              <Globe className='size-4' />
              Installed apps
            </div>
            {hasMoreInstalled && (
              <Link href='/app/settings/apps/installed'>
                <Button variant='ghost' size='sm'>
                  View all
                </Button>
              </Link>
            )}
          </div>
          <div className='w-full @container'>
            {installedAppsToShow.length > 0 ? (
              <div className='grid w-full gap-2 @sm:grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3'>
                {installedAppsToShow.map(({ app }) => (
                  <AppListCard
                    key={app.id}
                    app={app}
                    href={`/app/settings/apps/installed/${app.slug}`}
                  />
                ))}
              </div>
            ) : (
              <div className='border bg-primary-50 w-full p-6 rounded-2xl text-center text-sm text-muted-foreground'>
                No apps installed yet
              </div>
            )}
          </div>
        </div>
        <div className='space-y-6'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
              <Globe className='size-4' />
              Browse apps
            </div>
            <div className='text-sm text-muted-foreground'>
              Discover new apps to help you work better
            </div>
          </div>
          <div className='flex flex-col gap-6 justify-start w-full'>
            <div className='sticky pt-20 -mt-20  top-0'>
              <div className='grid grid-cols-3'>
                <Input
                  placeholder='Search apps'
                  className='col-start-2 col-span-2'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className='absolute left-0 top-[80px] z-1 pointer-events-none grid grid-cols-3'>
                <div className='pointer-events-auto '>
                  <div className='flex flex-col space-y-1'>
                    {categoriesToDisplay.map((category) => {
                      const IconComponent = iconMap[category.icon as keyof typeof iconMap]
                      const isActive = activeCategory === category.value
                      return (
                        <Button
                          key={category.value}
                          variant={isActive ? 'default' : 'outline'}
                          className='justify-start'
                          size='sm'
                          onClick={() => scrollToCategory(category.value)}>
                          {IconComponent && <IconComponent />}
                          {category.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className='grid  pt-2 w-full grid-cols-3 gap-4'>
              <div className='flex w-full flex-col justify-start col-start-2 col-end-4 space-y-8'>
                {filteredApps.length === 0 && searchQuery.trim() ? (
                  <div className='text-center py-12 text-muted-foreground'>
                    <div className='text-base font-medium mb-2'>No apps found</div>
                    <div className='text-sm'>
                      Try adjusting your search query to find what you're looking for
                    </div>
                  </div>
                ) : (
                  categoriesToDisplay.map((category) => {
                    const categoryApps = appsByCategory[category.value] || []
                    const hasCategoryApps = categoryApps.length > 0

                    return (
                      <section
                        key={category.value}
                        ref={(el) => {
                          sectionRefs.current[category.value] = el
                        }}
                        data-category={category.value}
                        className='flex flex-col w-full gap-2'>
                        <div className='text-base font-normal'>{category.label}</div>
                        {hasCategoryApps ? (
                          <div className='grid w-full gap-2 grid-cols-2'>
                            {categoryApps.map((app) => (
                              <AppListCard key={app.id} app={app} />
                            ))}
                          </div>
                        ) : (
                          <div className='text-sm text-muted-foreground h-100'>
                            No apps in this category yet
                          </div>
                        )}
                      </section>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsPage>
  )
}
