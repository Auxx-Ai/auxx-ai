// apps/web/src/components/webhooks/hooks/use-webhook-endpoint.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { api, type RouterOutputs } from '~/trpc/react'

/** One inbound endpoint as projected by `webhookEndpoint.list` (secret masked to `hasSecret`). */
export type WebhookEndpointRow = RouterOutputs['webhookEndpoint']['list'][number]

/**
 * CRUD wrappers over `api.webhookEndpoint` for the Incoming webhooks section.
 * Error-toasts only (repo rule); the list is invalidated on every mutation that
 * changes it. `create`/`rotateSecret` return the one-time plaintext secret in their
 * result — surface it from the caller (never refetched).
 */
export function useWebhookEndpoint() {
  const utils = api.useUtils()
  const listQuery = api.webhookEndpoint.list.useQuery()
  const invalidate = () => void utils.webhookEndpoint.list.invalidate()

  const create = api.webhookEndpoint.create.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to create endpoint', description: error.message }),
  })
  const update = api.webhookEndpoint.update.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to update endpoint', description: error.message }),
  })
  const rotateSecret = api.webhookEndpoint.rotateSecret.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to rotate secret', description: error.message }),
  })
  const destroy = api.webhookEndpoint.delete.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to delete endpoint', description: error.message }),
  })

  return {
    data: listQuery.data,
    isLoading: listQuery.isLoading,
    create,
    update,
    rotateSecret,
    destroy,
    invalidate,
  }
}
