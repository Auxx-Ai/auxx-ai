// apps/web/src/components/file-upload/transport/server-id.ts

import type { ServerIdKind } from '@auxx/lib/files/client'
import type { CompletionResult } from './types'

/** Which server record a completion produced, and its id. */
export interface ResolvedServerId {
  /** `undefined` when the completion carried no usable record id. */
  serverId?: string
  kind: ServerIdKind
}

/**
 * Decide which id a completion response actually produced.
 *
 * An attachment/asset processor returns `assetId` (a `MediaAsset`); `FileProcessor`
 * returns only `fileId` (a `FolderFile`). Recording the kind alongside the id is
 * what stops a `FolderFile` id — or, worse, the upload-session nanoid parked in
 * `serverFileId` at session-create time — being reported downstream as an asset id
 * (`docs/files-upload-architecture-guide.md` §11.3).
 *
 * `'session'` means neither id came back, so whatever `serverFileId` already holds
 * stays there and is labelled as the session nanoid it is.
 */
export function resolveServerId(completion: CompletionResult | null | undefined): ResolvedServerId {
  if (completion?.assetId) return { serverId: completion.assetId, kind: 'asset' }
  if (completion?.fileId) return { serverId: completion.fileId, kind: 'file' }
  return { kind: 'session' }
}
