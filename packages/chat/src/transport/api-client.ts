// packages/chat/src/transport/api-client.ts
//
// Shared fetch wrapper for the visitor-facing api surface. Owns passport
// minting + bearer auth, single-retry on 401 with a forced passport refresh,
// and ApiEnvelope unwrapping so endpoint files stay declarative.

import { getApiBase } from '~/shared/runtime-config'
import { getChatPassport } from './passport'

export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

export interface ApiRequest {
  method?: string
  body?: unknown
  query?: Record<string, string>
  signal?: AbortSignal
}

export async function authedFetch<T>(
  channelId: string,
  path: string,
  init: ApiRequest = {}
): Promise<T> {
  const method = init.method ?? 'GET'

  const doFetch = async (token: string) => {
    let url = `${getApiBase()}${path}`
    if (init.query) {
      const qs = new URLSearchParams(init.query).toString()
      if (qs) url += `?${qs}`
    }
    return fetch(url, {
      method,
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
  }

  let { passport } = await getChatPassport(channelId)
  let res = await doFetch(passport)

  if (res.status === 401) {
    passport = (await getChatPassport(channelId, { force: true })).passport
    res = await doFetch(passport)
  }

  const json = (await res.json()) as ApiEnvelope<T>
  if (!res.ok || !json.success || json.data === undefined) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`)
  }
  return json.data
}
