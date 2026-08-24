// apps/web/src/components/file-upload/transport/__fixtures__/fake-upload-transport.ts

import type {
  CompletionInput,
  CompletionResult,
  CreateSessionInput,
  PresignedConfig,
  UploadHandle,
  UploadTransport,
} from '../types'

/**
 * A substitute for {@link UploadTransport} that never touches the network.
 *
 * Recorded calls are exposed through **methods**, not through a plain-object
 * `calls` field: the transport is stored on the Zustand store, which runs under
 * Immer, and Immer deep-freezes any plain object or array assigned into a draft.
 * A frozen `calls.createSession` array would silently refuse every `push`. Methods
 * close over their arrays instead, and functions are not draftable, so nothing
 * here can be frozen.
 *
 * Lives in `__fixtures__` rather than `__tests__` because apps/web's Vitest
 * `include` treats every file under `__tests__` as a suite.
 */
export interface FakeUploadTransport extends UploadTransport {
  /** Every `createSession` input, in call order. */
  createdSessions(): CreateSessionInput[]
  /** Every `completeSession` call, in call order. */
  completedSessions(): Array<{ sessionId: string; body: CompletionInput }>
  /** Names of files whose upload handle had `abort()` called. */
  abortedFiles(): string[]
}

export interface FakeUploadTransportOptions {
  /** Override session creation — throw from here to fail the presign step. */
  createSession?: (input: CreateSessionInput) => Promise<PresignedConfig>
  /** Override the object write — return a never-settling promise to hang a file. */
  uploadObject?: (params: Parameters<UploadTransport['uploadObject']>[0]) => UploadHandle
  /** Override completion — throw from here to fail after the bytes landed. */
  completeSession?: (sessionId: string, body: CompletionInput) => Promise<CompletionResult>
}

/** Default presigned config: a single-part PUT, one session id per file. */
function defaultPresignedConfig(input: CreateSessionInput, index: number): PresignedConfig {
  return {
    sessionId: `ses_${index}`,
    storageKey: `org1/${input.entityType}/${input.fileName}`,
    uploadMethod: 'single',
    uploadType: 'PUT',
    presignedUrl: 'https://storage.test/put',
  }
}

export function createFakeUploadTransport(
  options: FakeUploadTransportOptions = {}
): FakeUploadTransport {
  const created: CreateSessionInput[] = []
  const completed: Array<{ sessionId: string; body: CompletionInput }> = []
  const aborted: string[] = []

  return {
    async createSession(input) {
      created.push(input)
      if (options.createSession) return options.createSession(input)
      return defaultPresignedConfig(input, created.length)
    },

    uploadObject(params) {
      if (options.uploadObject) return options.uploadObject(params)
      return {
        abort: () => {
          aborted.push(params.file.name)
        },
        promise: Promise.resolve({ etag: `etag_${params.file.name}` }),
      }
    },

    async completeSession(sessionId, body) {
      completed.push({ sessionId, body })
      if (options.completeSession) return options.completeSession(sessionId, body)
      return {
        success: true,
        sessionId,
        storageLocationId: `sl_${sessionId}`,
        assetId: `ast_${sessionId}`,
        url: `https://cdn.test/${sessionId}`,
      }
    },

    createdSessions: () => [...created],
    completedSessions: () => [...completed],
    abortedFiles: () => [...aborted],
  }
}
