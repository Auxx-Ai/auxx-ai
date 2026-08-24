// apps/web/src/components/file-upload/transport/http-upload-transport.ts

import { directUpload } from './direct-upload'
import type {
  CompletionInput,
  CompletionResult,
  CreateSessionInput,
  PresignedConfig,
  UploadHandle,
  UploadTransport,
} from './types'
import { parseUploadErrorResponse } from './upload-error'

/**
 * The real transport: the three `/api/files/upload/*` routes, plus the direct
 * PUT/multipart write to storage.
 *
 * This is the only place in the uploader that knows a URL. Everything above it
 * talks to {@link UploadTransport}, so the Phase 4 response-shape changes and any
 * future ones land here and nowhere else.
 */
export const httpUploadTransport: UploadTransport = {
  async createSession(input: CreateSessionInput): Promise<PresignedConfig> {
    const response = await fetch('/api/files/upload/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      // Reads the body. The storage-quota 403's "upgrade your plan" message and
      // the `files.manage` 403 both live in there and used to be discarded.
      throw await parseUploadErrorResponse(response, 'Session create failed')
    }

    return (await response.json()) as PresignedConfig
  },

  uploadObject(params): UploadHandle {
    return directUpload(params)
  },

  async abortSession(sessionId: string): Promise<void> {
    // `keepalive` so the request still goes out when the cancel is the user
    // closing the popover or the tab: a normal fetch is torn down with the page
    // and the abort never reaches the server.
    await fetch(`/api/files/upload/${sessionId}/abort`, { method: 'POST', keepalive: true })
  },

  async completeSession(sessionId: string, body: CompletionInput): Promise<CompletionResult> {
    const response = await fetch(`/api/files/upload/${sessionId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      // 400 = malformed body, session still alive and completable (PR 4e).
      // 422 = the delivered object broke the session's policy, with the real reason.
      throw await parseUploadErrorResponse(response, 'Complete failed')
    }

    try {
      return (await response.json()) as CompletionResult
    } catch {
      // The bytes are stored and the server said 200; an unreadable body costs us
      // the record ids, not the upload. Reported as an empty result, which
      // `resolveServerId` reads as `'session'`.
      return {}
    }
  },
}
