// apps/extension/src/iframe/routes/contact-route.tsx

import { useEffect, useState } from 'react'
import { RecordEmbed } from '../components/record-embed'
import { BASE_URL, getRecordById, type RecordGetByIdOutput, TrpcCallError } from '../trpc'
import { instanceIdFromRecordId, type Route } from './types'

type Props = Extract<Route, { kind: 'contact' }>

/**
 * Contact detail route. Fetches the record once for the displayName surface
 * shown above the embed, then mounts an `<iframe src="/embed/record/...">`
 * that hosts the same `PropertyProvider` / `PropertyRow` editing surface the
 * web sidebar uses — drag-and-drop and edit mode aside.
 */
export function ContactRoute({ recordId }: Props) {
  const state = useRecordFetch(recordId)
  const openHref = `${BASE_URL}/app/contacts/${instanceIdFromRecordId(recordId)}`
  const displayName = state.status === 'ready' ? (state.record.displayName ?? null) : null

  if (state.status === 'loading') {
    return <p className='text-sm text-muted-foreground'>Loading…</p>
  }
  if (state.status === 'error') {
    return <p className='text-sm text-destructive'>{state.message}</p>
  }

  return <RecordEmbed recordId={recordId} openHref={openHref} displayName={displayName} />
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
