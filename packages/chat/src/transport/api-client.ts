// packages/chat/src/transport/api-client.ts
//
// Shared fetch wrapper for the visitor-facing api surface. Owns passport
// minting + bearer auth, single-retry on 401 with a forced passport refresh,
// and ApiEnvelope unwrapping so endpoint files stay declarative.

import { buildUserDataEnvelope, getApiBase } from '~/shared/runtime-config'
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

  // v4 phase 3 — every authed write carries the customer's signed JWT
  // (when boot supplied one) inside the `user_data` envelope. Per-request
  // middleware re-verifies it server-side. GET/HEAD requests don't take a
  // body, so they skip the envelope — only the passport authenticates them.
  const userData = buildUserDataEnvelope()
  const bodyObject =
    init.body !== undefined && init.body !== null
      ? typeof init.body === 'object'
        ? (init.body as Record<string, unknown>)
        : { value: init.body }
      : null
  const finalBody =
    userData && method !== 'GET' && method !== 'HEAD'
      ? { ...(bodyObject ?? {}), user_data: userData }
      : bodyObject
  const hasBody = finalBody !== null

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
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(finalBody) : undefined,
      signal: init.signal,
    })
  }

  let { passport } = await getChatPassport(channelId)
  let res = await doFetch(passport)
  let json = (await res.json()) as ApiEnvelope<T>

  // Bounded one-retry on:
  //   - 401 (expired / invalid passport)
  //   - IDENTITY_MISMATCH (the cached passport was minted for a different JWT
  //     identity than the one carried on this request — happens when the host
  //     app rotates the user without calling Auxx.logout() or Auxx.boot()
  //     again first). `getChatPassport({ force: true })` drops the stored
  //     passport then mints a new one with the current JWT.
  const isMismatch = !json.success && json.error?.code === 'IDENTITY_MISMATCH'
  if (res.status === 401 || isMismatch) {
    passport = (await getChatPassport(channelId, { force: true })).passport
    res = await doFetch(passport)
    json = (await res.json()) as ApiEnvelope<T>
  }

  if (!res.ok || !json.success || json.data === undefined) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`)
  }
  return json.data
}
