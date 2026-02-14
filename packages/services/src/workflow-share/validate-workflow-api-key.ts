// packages/services/src/workflow-share/validate-workflow-api-key.ts

import { hashApiKey } from '@auxx/credentials/api-key'
import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { WorkflowShareError } from './errors'

/**
 * Options for API key validation
 */
export interface ValidateWorkflowApiKeyOptions {
  workflowAppId: string
  apiKey: string
}

/**
 * API key validation result
 */
export interface ApiKeyValidationResult {
  isValid: boolean
  apiKeyId?: string
}

/**
 * Validate an API key for workflow access
 * Uses the existing ApiKey table with type='workflow'
 *
 * @param options - Validation options
 * @returns Result with validation status
 */
export async function validateWorkflowApiKey(
  options: ValidateWorkflowApiKeyOptions
): Promise<Result<ApiKeyValidationResult, WorkflowShareError>> {
  const { workflowAppId, apiKey } = options

  const hashedKey = hashApiKey(apiKey)

  const dbResult = await fromDatabase(
    database.query.ApiKey.findFirst({
      where: and(
        eq(schema.ApiKey.hashedKey, hashedKey),
        eq(schema.ApiKey.type, 'workflow'),
        eq(schema.ApiKey.referenceId, workflowAppId),
        eq(schema.ApiKey.isActive, true)
      ),
      columns: {
        id: true,
      },
    }),
    'validate-workflow-api-key'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const key = dbResult.value

  return ok({
    isValid: !!key,
    apiKeyId: key?.id,
  })
}
