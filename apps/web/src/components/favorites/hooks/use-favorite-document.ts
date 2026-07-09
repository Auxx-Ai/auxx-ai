// apps/web/src/components/favorites/hooks/use-favorite-document.ts
'use client'

import { api } from '~/trpc/react'

const STALE_TIME = 5 * 60 * 1000

export function useFavoriteDocument(documentId: string | null | undefined) {
  const { data, isLoading, error } = api.document.getById.useQuery(
    { documentId: documentId! },
    { enabled: !!documentId, staleTime: STALE_TIME, refetchOnWindowFocus: false }
  )
  const code = error?.data?.code
  // `document.getById` returns null (not an error) for a deleted/inaccessible
  // document, so treat settled-but-empty as not-found too — otherwise the
  // favorite would spin on a skeleton forever.
  const isNotFound = code === 'NOT_FOUND' || code === 'FORBIDDEN' || (!isLoading && !data)
  return { document: data, isLoading, isNotFound }
}
