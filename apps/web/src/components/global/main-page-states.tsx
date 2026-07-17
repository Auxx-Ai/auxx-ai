// apps/web/src/components/global/main-page-states.tsx

import Loader from '@auxx/ui/components/loader'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { FileText, Lock } from 'lucide-react'
import type React from 'react'
import { EmptyState } from '~/components/global/empty-state'

/** Props accepted by `MainPageContent` — re-derived since it isn't exported as a type. */
type MainPageContentProps = React.ComponentProps<typeof MainPageContent>

/**
 * `MainPageContent` + a centered `Loader` — the loading body for a route
 * that owns its `MainPage` shell (header/breadcrumbs stay static; only the
 * content area shows the spinner). See `docs/ui-design-guide.md` and
 * plans/ui/main-page-slots/01-slot-primitives.md.
 */
function MainPageLoading({
  title = 'Loading...',
  subtitle = 'Please wait',
  className,
  ...props
}: {
  title?: string
  subtitle?: string
} & Omit<MainPageContentProps, 'children'>) {
  return (
    <MainPageContent className={className} {...props}>
      <Loader size='sm' title={title} subtitle={subtitle} />
    </MainPageContent>
  )
}
MainPageLoading.displayName = 'MainPageLoading'

interface MainPageEmptyProps extends Omit<MainPageContentProps, 'children'> {
  icon?: React.ElementType
  title?: string
  description?: React.ReactNode
  /** Node rendered below the description (button, link, etc). */
  action?: React.ReactNode
  /** Full escape hatch — replaces the entire `EmptyState` body. */
  children?: React.ReactNode
}

/**
 * `MainPageContent` + a centered "not found" `EmptyState`. Every part is an
 * overridable prop; pass `children` to replace the body entirely.
 */
function MainPageNotFound({
  icon = FileText,
  title = 'Not found',
  description = "This page could not be found or you don't have access to it.",
  action,
  children,
  className,
  ...props
}: MainPageEmptyProps) {
  return (
    <MainPageContent className={className} {...props}>
      {children ?? (
        <EmptyState icon={icon} title={title} description={description} button={action} />
      )}
    </MainPageContent>
  )
}
MainPageNotFound.displayName = 'MainPageNotFound'

/**
 * `MainPageContent` + a centered "no permission" `EmptyState` (feature-gated
 * routes). Every part is an overridable prop; pass `children` to replace the
 * body entirely.
 */
function MainPageNoPermission({
  icon = Lock,
  title = 'Not available',
  description = 'Upgrade your plan to use this feature.',
  action,
  children,
  className,
  ...props
}: MainPageEmptyProps) {
  return (
    <MainPageContent className={className} {...props}>
      {children ?? (
        <EmptyState icon={icon} title={title} description={description} button={action} />
      )}
    </MainPageContent>
  )
}
MainPageNoPermission.displayName = 'MainPageNoPermission'

export { MainPageLoading, MainPageNotFound, MainPageNoPermission }
