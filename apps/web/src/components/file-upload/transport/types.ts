// apps/web/src/components/file-upload/transport/types.ts

import type { EntityType } from '@auxx/lib/files/types'

/**
 * The wire contract between the browser uploader and `/api/files/upload/*`.
 *
 * Every field here mirrors a route on `apps/web/src/app/api/files/upload/**`, so a
 * change to the request or response shape lands in this one file rather than being
 * spread across the orchestration slice's inline `fetch` bodies.
 */

/** Body of `POST /api/files/upload/sessions`. */
export interface CreateSessionInput {
  fileName: string
  mimeType: string
  expectedSize: number
  /**
   * Credential provider. Must stay a subset of the route's enum — there is no
   * `Local` adapter, and sending one turns a 400 into a 500.
   */
  provider?: 'S3' | 'GOOGLE_DRIVE' | 'DROPBOX' | 'ONEDRIVE' | 'BOX'
  entityType: EntityType
  entityId?: string
  metadata?: Record<string, unknown>
}

/**
 * Response of `POST /api/files/upload/sessions`, and everything
 * {@link UploadTransport.uploadObject} needs to put the bytes somewhere.
 *
 * `uploadMethod` is the strategy, `uploadType` is the HTTP verb. Both names are
 * legacy and both are load-bearing.
 */
export interface PresignedConfig {
  sessionId: string
  storageKey: string
  expiresAt?: string
  warnings?: string[]
  uploadMethod: 'single' | 'multipart'
  uploadType?: 'PUT' | 'POST'
  presignedUrl?: string
  presignedFields?: Record<string, string>
  uploadId?: string
  partPresignEndpoint?: string
}

/** Byte counts reported while the object is being written to storage. */
export interface UploadProgressEvent {
  loaded: number
  total: number
  percentage: number
}

/** What the browser learned by writing the object, and must report back to `complete`. */
export interface DirectUploadResult {
  etag?: string
  uploadId?: string
  parts?: Array<{ partNumber: number; etag: string }>
  storageKey?: string
}

/** A running object upload: a promise for the result, and a way to stop it. */
export interface UploadHandle {
  abort: () => void
  promise: Promise<DirectUploadResult>
}

/** Body of `POST /api/files/upload/{sessionId}/complete`. */
export interface CompletionInput {
  /** Advisory. The server knows the key from the session and never reads this. */
  storageKey?: string
  size: number
  mimeType: string
  etag?: string
  /** Multipart only, and required for it. */
  uploadId?: string
  /** Multipart only, and required for it. */
  parts?: Array<{ partNumber: number; etag: string }>
}

/**
 * Response of a successful completion.
 *
 * Every field is optional on purpose: which ids come back is decided by the
 * processor the entity type dispatched to — an asset processor returns `assetId`,
 * `FileProcessor` returns only `fileId` — and a success body that cannot be parsed
 * at all is reported as an empty result rather than as a failure, which is what the
 * inline code did before the transport existed.
 */
export interface CompletionResult {
  success?: boolean
  sessionId?: string
  storageLocationId?: string
  fileId?: string
  assetId?: string
  attachmentId?: string
  documentId?: string
  url?: string
}

/**
 * The network seam.
 *
 * The orchestration slice holds one of these on the store rather than calling
 * `fetch` itself, so a test can supply a transport that resolves immediately,
 * fails on the third file, or never settles — none of which is expressible by
 * stubbing global `fetch` and matching URL strings.
 */
export interface UploadTransport {
  /** Create the server-side presigned upload session for one file. */
  createSession(input: CreateSessionInput): Promise<PresignedConfig>

  /**
   * Write the bytes to storage. Returns synchronously with a handle so the caller
   * can register the abort before awaiting.
   */
  uploadObject(params: {
    file: File
    config: PresignedConfig
    onProgress?: (progress: UploadProgressEvent) => void
  }): UploadHandle

  /** Tell the server the bytes landed, and get back the rows it produced. */
  completeSession(sessionId: string, body: CompletionInput): Promise<CompletionResult>
}
