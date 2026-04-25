// apps/extension/src/iframe/routes/contact-route.tsx

import { useEffect, useState } from 'react'
import { RecordDetailSkeleton } from '../components/record-detail-skeleton'
import { BASE_URL, getRecordById, type RecordGetByIdOutput, TrpcCallError } from '../trpc'
import { instanceIdFromRecordId, type Route } from './types'

type Props = Extract<Route, { kind: 'contact' }>

/**
 * Read-only contact detail skeleton. Fetches `record.getById` on mount,
 * renders displayName + every field via the generic `RecordDetailSkeleton`.
 *
 * The "Open in Auxx" link sits inline next to the displayName inside the
 * skeleton — the header is intentionally minimal (dropdown + back chevron).
 *
 * The full editor (typed field renderer, edit mode, mutations) is the next
 * plan — this just proves the route navigation + fetch path.
 */
export function ContactRoute({ recordId }: Props) {
  const state = useRecordFetch(recordId)
  const openHref = `${BASE_URL}/app/contacts/${instanceIdFromRecordId(recordId)}`
  return <RecordDetailSkeleton state={state} openHref={openHref} />
}

export type RecordFetchState =
  | { status: 'loading' }
  | { status: 'ready'; record: RecordGetByIdOutput }
  | { status: 'error'; message: string }

/**
 * Shared fetch hook used by both contact and company detail routes. Single
 * fire on mount keyed by recordId — no refetch on remount of the same id.
 */
export function useRecordFetch(recordId: string): RecordFetchState {
  const [state, setState] = useState<RecordFetchState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void getRecordById(recordId)
      .then((record) => {
        if (!cancelled) setState({ status: 'ready', record })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message =
          err instanceof TrpcCallError
            ? `Couldn't load (${err.code ?? err.httpStatus ?? 'error'}): ${err.message}`
            : err instanceof Error
              ? err.message
              : "Couldn't load this record."
        setState({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [recordId])

  return state
}
