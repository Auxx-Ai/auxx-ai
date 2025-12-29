// apps/web/src/app/admin/_lib/breadcrumbs.ts

/**
 * Breadcrumb item interface
 */
export interface BreadcrumbItem {
  /** Display title for the breadcrumb */
  title: string
  /** Navigation href for the breadcrumb */
  href: string
}

/**
 * Admin page types for breadcrumb generation
 */
export type AdminPage = 'dashboard' | 'users' | 'organizations' | 'plans' | 'apps'

/**
 * Subpage information for detail pages
 */
export interface SubpageInfo {
  /** Display title for the subpage */
  title: string
  /** ID or slug for the subpage */
  id: string
}

/**
 * Generate breadcrumb items for admin routes
 *
 * @param page - The admin page type
 * @param subpage - Optional subpage information for detail pages
 * @returns Array of breadcrumb items for navigation
 *
 * @example
 * // Dashboard
 * getAdminBreadcrumbs('dashboard')
 * // => [{ title: 'Admin', href: '/admin' }]
 *
 * @example
 * // Users list
 * getAdminBreadcrumbs('users')
 * // => [{ title: 'Admin', href: '/admin' }, { title: 'Users', href: '/admin/users' }]
 *
 * @example
 * // User detail
 * getAdminBreadcrumbs('users', { title: 'John Doe', id: '123' })
 * // => [
 * //   { title: 'Admin', href: '/admin' },
 * //   { title: 'Users', href: '/admin/users' },
 * //   { title: 'John Doe', href: '/admin/users/123' }
 * // ]
 */
export function getAdminBreadcrumbs(page: AdminPage, subpage?: SubpageInfo): BreadcrumbItem[] {
  const base: BreadcrumbItem = { title: 'Admin', href: '/admin' }

  const pages: Record<AdminPage, BreadcrumbItem> = {
    dashboard: base,
    users: { title: 'Users', href: '/admin/users' },
    organizations: { title: 'Organizations', href: '/admin/organizations' },
    plans: { title: 'Plans', href: '/admin/plans' },
    apps: { title: 'Apps', href: '/admin/apps' },
  }

  // Dashboard only shows base breadcrumb
  if (page === 'dashboard') return [base]

  // Build breadcrumbs array
  const breadcrumbs = [base, pages[page]]

  // Add subpage breadcrumb if provided
  if (subpage) {
    breadcrumbs.push({
      title: subpage.title,
      href: `${pages[page].href}/${subpage.id}`,
    })
  }

  return breadcrumbs
}

/**
 * Generate breadcrumb items for create/new pages
 *
 * @param page - The admin page type
 * @param action - The action type (e.g., 'new', 'create', 'edit')
 * @returns Array of breadcrumb items for navigation
 *
 * @example
 * // New plan
 * getAdminActionBreadcrumbs('plans', 'new')
 * // => [
 * //   { title: 'Admin', href: '/admin' },
 * //   { title: 'Plans', href: '/admin/plans' },
 * //   { title: 'New Plan', href: '/admin/plans/new' }
 * // ]
 */
export function getAdminActionBreadcrumbs(page: AdminPage, action: string): BreadcrumbItem[] {
  const base: BreadcrumbItem = { title: 'Admin', href: '/admin' }

  const pages: Record<AdminPage, BreadcrumbItem> = {
    dashboard: base,
    users: { title: 'Users', href: '/admin/users' },
    organizations: { title: 'Organizations', href: '/admin/organizations' },
    plans: { title: 'Plans', href: '/admin/plans' },
    apps: { title: 'Apps', href: '/admin/apps' },
  }

  // Build breadcrumbs array
  const breadcrumbs = [base, pages[page]]

  // Add action breadcrumb
  const actionTitle = action === 'new' ? `New ${pages[page].title.slice(0, -1)}` : action
  breadcrumbs.push({
    title: actionTitle,
    href: `${pages[page].href}/${action}`,
  })

  return breadcrumbs
}
