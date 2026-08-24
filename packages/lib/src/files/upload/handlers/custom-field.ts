// packages/lib/src/files/upload/handlers/custom-field.ts

import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import { type FileTypeCategory, getMimePatternsForCategories } from '../../file-type-constants'
import { ENTITY_TYPES } from '../../types/entities'
import type { UploadPreparedConfig } from '../init-types'
import { ASSET_MAX_TTL_SEC, hasTempPrefix, MB, tempExpiry } from './shared'
import type { UploadHandler } from './types'

const logger = createScopedLogger('upload-handler-custom-field')

/** Uploads aimed at a field value that does not exist yet carry this entity-id prefix. */
const TEMP_FIELD_PREFIX = 'field-'

/** The shape a `FILE` custom field stores under `options.file`. */
export interface CustomFieldFileOptions {
  allowedFileTypes?: string[]
  allowedFileExtensions?: string[]
}

/**
 * Apply one field's `options.file` to a prepared config's policy.
 *
 * Split out of {@link customFieldHandler.refineConfig} so the narrowing itself
 * is a pure function: `getOrgCache()` is a module-scope singleton with a live
 * Redis behind it, and a test that had to reach through it could only assert
 * this logic by mocking the cache.
 */
export function narrowPolicyToFieldOptions(
  config: UploadPreparedConfig,
  fileOptions: CustomFieldFileOptions | undefined
): UploadPreparedConfig {
  if (!fileOptions) return config

  const policy = { ...config.policy }
  if (fileOptions.allowedFileTypes?.length) {
    policy.allowedMimeTypes = getMimePatternsForCategories(
      fileOptions.allowedFileTypes as FileTypeCategory[]
    )
  }
  if (fileOptions.allowedFileExtensions?.length) {
    policy.allowedExtensions = fileOptions.allowedFileExtensions
  }

  return Object.freeze({ ...config, policy })
}

/**
 * Files stored in a custom field of type `FILE`.
 *
 * `*​/*` and 25 MB are the outer bounds only. The field's own `options.file`
 * narrows the MIME list per field, which needs the org cache and therefore
 * arrives through {@link UploadHandler.refineConfig} rather than the record.
 *
 * There is no `validateEntity`: `CustomFieldProcessor.validateEntityAccess`
 * returned early for the temp prefix and then did nothing at all, so every
 * `CUSTOM_FIELD` upload was unvalidated. Restated rather than quietly fixed —
 * giving it teeth would reject uploads that work today.
 */
export const customFieldHandler: UploadHandler = {
  entityType: ENTITY_TYPES.CUSTOM_FIELD,
  visibility: 'PRIVATE',
  maxFileSize: 25 * MB,
  allowedMimeTypes: ['*/*'],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'TEMP_UPLOAD',
  persist: 'asset+attachment',

  assetExpiresAt: (session, now) =>
    hasTempPrefix(session, TEMP_FIELD_PREFIX) ? tempExpiry(now) : undefined,

  /**
   * Narrow the policy to what this particular field accepts.
   *
   * Runs after `buildUploadConfig` and before the presign, so the narrowed list
   * is the one `enforceUploadPolicy` judges the request against *and* the one
   * persisted on the session — which is what makes it survive to
   * `validateCompletedUpload` rather than applying only to the signature.
   *
   * A field that is not in the cache is not an error: the upload falls back to
   * the handler's own bounds, exactly as before.
   */
  async refineConfig(_ctx, config, init) {
    const fieldId = init.metadata?.fieldId as string | undefined
    if (!fieldId) return config

    const customField = await getOrgCache().from(init.organizationId, 'customFields').byId(fieldId)

    if (!customField) {
      logger.warn('Custom field not found in cache, using default validation', { fieldId })
      return config
    }

    const fileOptions = (customField.options as Record<string, unknown> | null)?.file as
      | CustomFieldFileOptions
      | undefined

    return narrowPolicyToFieldOptions(config, fileOptions)
  },
}
