// apps/web/src/components/record-rules/hooks/use-record-rules.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/** List + CRUD wiring over `api.recordRules` with list invalidation and error toasts. */
export function useRecordRules() {
  const utils = api.useUtils()
  const list = api.recordRules.list.useQuery()

  const invalidate = () => utils.recordRules.list.invalidate()

  const create = api.recordRules.create.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error creating rule', description: error.message }),
  })
  const update = api.recordRules.update.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error updating rule', description: error.message }),
  })
  const setEnabled = api.recordRules.setEnabled.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error toggling rule', description: error.message }),
  })
  const destroy = api.recordRules.delete.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error deleting rule', description: error.message }),
  })

  return { list, create, update, setEnabled, destroy }
}
