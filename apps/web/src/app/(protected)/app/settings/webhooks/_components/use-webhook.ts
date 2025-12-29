// apps/web/src/app/(protected)/app/settings/webhooks/_components/use-webhook.ts
'use client'
import { api } from '~/trpc/react'
import { useState } from 'react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
export function useWebhook() {
  const [isDestroying, setIsDestroying] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState<string | null>(null)
  const webhooksQuery = api.webhook.list.useQuery()
  const create = api.webhook.create.useMutation({
    onSuccess: () => {
      webhooksQuery.refetch()
      toastSuccess({ title: 'Webhook created successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Failed to create webhook', description: error.message })
    },
  })
  const update = api.webhook.update.useMutation({
    onMutate: (variables) => {
      setIsUpdating(variables.id)
    },
    onSuccess: () => {
      setIsUpdating(null)
      webhooksQuery.refetch()
      toastSuccess({ title: 'Webhook updated successfully' })
    },
    onError: (error) => {
      setIsUpdating(null)
      toastError({ title: 'Failed to update webhook', description: error.message })
    },
  })
  const destroy = api.webhook.delete.useMutation({
    onMutate: (variables) => {
      setIsDestroying(variables.id)
    },
    onSuccess: () => {
      setIsDestroying(null)
      webhooksQuery.refetch()
      toastSuccess({ title: 'Webhook deleted successfully' })
    },
    onError: (error) => {
      setIsDestroying(null)
      toastError({ title: 'Failed to delete webhook', description: error.message })
    },
  })
  const testWebhook = api.webhook.test.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Webhook test successful' })
    },
    onError: (error) => {
      toastError({ title: 'Failed to test webhook', description: error.message })
    },
  })
  return {
    data: webhooksQuery.data,
    isLoading: webhooksQuery.isLoading,
    isDestroying,
    isUpdating,
    create,
    update,
    destroy,
    testWebhook,
  }
}
