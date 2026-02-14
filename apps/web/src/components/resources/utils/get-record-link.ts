// apps/web/src/components/resources/utils/get-record-link.ts

'use client'

import type { RecordId, Resource } from '@auxx/lib/resources/client'
import { getDefinitionId, isSystemResource, parseRecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useResourceStore } from '../store/resource-store'

/**
 * Options for generating record links
 */
export interface GetRecordLinkOptions {
  /**
   * Which tab to open (e.g., 'overview', 'activity', 'relationships', 'history')
   * Will be appended as a query parameter: ?tab=overview
   */
  tab?: string

  /**
   * Specific action to perform (e.g., 'edit', 'delete', 'duplicate')
   * Can be used by the detail page to open specific dialogs/modals
   */
  action?: 'edit' | 'delete' | 'duplicate' | 'archive' | string

  /**
   * Return absolute URL including origin (e.g., https://app.auxx.ai/app/contacts/123)
   * Default: false (returns relative path)
   */
  absolute?: boolean

  /**
   * Base URL to use when generating absolute URLs
   * Default: window.location.origin (if available)
   */
  baseUrl?: string

  /**
   * Additional query parameters to append
   * Example: { filter: 'active', sort: 'name' }
   */
  query?: Record<string, string | number | boolean>

  /**
   * Hash/anchor to append to the URL
   * Example: '#comments' -> /app/contacts/123#comments
   */
  hash?: string

  /**
   * View mode for list pages (if linking to a filtered list view)
   * Example: 'list', 'kanban', 'timeline'
   */
  view?: 'list' | 'kanban' | 'timeline' | 'calendar' | string

  /**
   * Parent resource context (useful for relationship navigation)
   * Example: When opening a contact from a ticket, pass the ticket's recordId
   */
  parentRecordId?: RecordId
}

/**
 * Pure function to generate a link to a record detail page
 *
 * @param recordId - RecordId in format "entityDefinitionId:entityInstanceId"
 * @param resource - The resource object (system or custom)
 * @param options - Optional configuration for the link
 * @returns The URL path
 *
 * @example
 * // Basic usage
 * const link = getRecordLink('contact:abc123', contactResource)
 * // Returns: '/app/contacts/abc123'
 *
 * @example
 * // With options
 * const link = getRecordLink('contact:abc123', contactResource, {
 *   tab: 'activity',
 *   action: 'edit',
 *   query: { filter: 'recent' }
 * })
 * // Returns: '/app/contacts/abc123?tab=activity&action=edit&filter=recent'
 *
 * @example
 * // Custom resource
 * const link = getRecordLink('cm123:inst456', customResource, {
 *   tab: 'overview'
 * })
 * // Returns: '/app/custom/companies/inst456?tab=overview'
 */
export function getRecordLink(
  recordId: RecordId,
  resource: Resource,
  options: GetRecordLinkOptions = {}
): string {
  const { entityInstanceId } = parseRecordId(recordId)

  // Build base path
  const isSystem = isSystemResource(resource)
  const basePath = isSystem
    ? `/app/${resource.apiSlug}/${entityInstanceId}`
    : `/app/custom/${resource.apiSlug}/${entityInstanceId}`

  // Build query parameters
  const queryParams = new URLSearchParams()

  // Add tab if specified
  if (options.tab) {
    queryParams.append('tab', options.tab)
  }

  // Add action if specified
  if (options.action) {
    queryParams.append('action', options.action)
  }

  // Add view if specified
  if (options.view) {
    queryParams.append('view', options.view)
  }

  // Add parent resource context if specified
  if (options.parentRecordId) {
    queryParams.append('from', options.parentRecordId)
  }

  // Add custom query parameters
  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      queryParams.append(key, String(value))
    })
  }

  // Build final URL
  const queryString = queryParams.toString()
  const hash = options.hash ? `#${options.hash.replace(/^#/, '')}` : ''
  let href = basePath

  if (queryString) {
    href += `?${queryString}`
  }

  if (hash) {
    href += hash
  }

  // Make absolute if requested
  if (options.absolute) {
    const baseUrl = options.baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
    href = `${baseUrl}${href}`
  }

  return href
}

/**
 * Hook to generate a link to a record detail page
 * Automatically looks up the resource from the provider
 *
 * @param recordId - RecordId in format "entityDefinitionId:entityInstanceId"
 * @param options - Optional configuration for the link
 * @returns The URL path, or null if resource not found
 *
 * @example
 * // Basic usage
 * const link = useRecordLink('contact:abc123')
 * // Returns: '/app/contacts/abc123'
 *
 * @example
 * // With options
 * const link = useRecordLink('contact:abc123', {
 *   tab: 'activity',
 *   action: 'edit',
 *   query: { filter: 'recent' }
 * })
 * // Returns: '/app/contacts/abc123?tab=activity&action=edit&filter=recent'
 *
 * @example
 * // Absolute URL
 * const link = useRecordLink('contact:abc123', {
 *   absolute: true,
 *   baseUrl: 'https://app.auxx.ai'
 * })
 * // Returns: 'https://app.auxx.ai/app/contacts/abc123'
 *
 * @example
 * // Custom resource
 * const link = useRecordLink('cm123:inst456', {
 *   tab: 'overview'
 * })
 * // Returns: '/app/custom/companies/inst456?tab=overview'
 */
export function useRecordLink(
  recordId: RecordId | null | undefined,
  options: GetRecordLinkOptions = {}
): string | null {
  const getResourceById = useResourceStore((s) => s.getResourceById)

  return useMemo(() => {
    if (!recordId) return null

    // Look up the resource
    const entityDefinitionId = getDefinitionId(recordId)
    const resource = getResourceById(entityDefinitionId)

    if (!resource) {
      console.warn(`Resource not found for recordId: ${recordId}`)
      return null
    }

    // Use the pure function
    return getRecordLink(recordId, resource, options)
  }, [recordId, getResourceById, options])
}
