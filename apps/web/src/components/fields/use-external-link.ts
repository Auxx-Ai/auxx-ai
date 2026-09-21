// apps/web/src/components/fields/use-external-link.ts
'use client'

import type { RecordId } from '@auxx/lib/field-values/client'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/**
 * Opens a record's page in the external system it was synced from. The href is
 * resolved lazily (`record.getExternalLink`); `prefetch` on hover fills the
 * cache so the click can `window.open` synchronously and dodge popup blockers.
 */
export function useExternalLink(recordId: RecordId) {
  const utils = api.useUtils()

  return useMemo(() => {
    const prefetch = (source: string, connectionId: string | null) => {
      void utils.record.getExternalLink.prefetch({ recordId, source, connectionId })
    }

    const open = async (source: string, connectionId: string | null) => {
      const input = { recordId, source, connectionId }
      const cached = utils.record.getExternalLink.getData(input)
      if (cached?.href) {
        window.open(cached.href, '_blank', 'noopener,noreferrer')
        return
      }
      try {
        const { href } = await utils.record.getExternalLink.fetch(input)
        if (!href) {
          toastError({
            title: 'No link available',
            description: "This record doesn't have a page in the connected app.",
          })
          return
        }
        window.open(href, '_blank', 'noopener,noreferrer')
      } catch (error) {
        toastError({
          title: 'No link available',
          description: error instanceof Error ? error.message : 'Could not resolve the link.',
        })
      }
    }

    return { open, prefetch }
  }, [utils, recordId])
}
