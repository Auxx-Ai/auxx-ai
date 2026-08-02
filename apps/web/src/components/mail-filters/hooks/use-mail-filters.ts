// apps/web/src/components/mail-filters/hooks/use-mail-filters.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/**
 * List + CRUD wiring over `api.mailFilters`, with list invalidation and error
 * toasts — the `useRecordRules` shape.
 *
 * `authorableInboxes` rides along because it is not decoration: it is the SAME
 * computation the router scopes `list` with (§5.1), so it is what the section
 * groups by, what the create flow's inbox picker offers, and what decides
 * whether the section renders at all (§6.4).
 */
export function useMailFilters() {
  const utils = api.useUtils()
  const list = api.mailFilters.list.useQuery()
  const inboxes = api.mailFilters.authorableInboxes.useQuery()

  const invalidate = () => utils.mailFilters.list.invalidate()

  const createFilter = api.mailFilters.create.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error creating filter', description: error.message }),
  })
  const updateFilter = api.mailFilters.update.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error updating filter', description: error.message }),
  })
  const setEnabled = api.mailFilters.setEnabled.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error toggling filter', description: error.message }),
  })
  const reorder = api.mailFilters.reorder.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error reordering filters', description: error.message }),
  })
  const destroy = api.mailFilters.delete.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error deleting filter', description: error.message }),
  })

  return { list, inboxes, createFilter, updateFilter, setEnabled, reorder, destroy }
}
