// packages/lib/src/files/upload/handlers/workflow-run.ts

import { UPLOAD_POLICIES } from '../../types/entities'
import { tempExpiry } from './shared'
import type { UploadHandler } from './types'

/**
 * Files handed to, or produced by, a workflow run. Temporary by nature.
 *
 * There is no `validateEntity`: `WorkflowRunProcessor.validateEntityAccess` was
 * an empty body under a commented-out query, and inventing a check here would be
 * a behaviour change dressed as a refactor.
 */
export const workflowRunHandler: UploadHandler = {
  ...UPLOAD_POLICIES.WORKFLOW_RUN,
  visibility: 'PRIVATE',
  assetKind: 'TEMP_UPLOAD',
  persist: 'asset+attachment',

  // A run's files are marked temporary by the caller; an explicit deadline in
  // the metadata wins over the default window.
  assetExpiresAt: (session, now) => {
    if (!session.metadata?.isTemporary) return undefined
    const declared = session.metadata.expiresAt
    return declared ? new Date(declared) : tempExpiry(now)
  },
}
