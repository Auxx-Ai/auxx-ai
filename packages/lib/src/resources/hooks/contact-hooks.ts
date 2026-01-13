// packages/lib/src/resources/hooks/contact-hooks.ts

import { isValidEmail, normalizeEmail as normalizeEmailUtil } from '@auxx/utils/email'
import { checkUniqueValue } from '@auxx/services/custom-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Validate email format for primary_email field
 */
const validateEmailFormat: SystemHook = async ({ field, values }) => {
  const email = values[field.id]

  if (email && typeof email === 'string') {
    if (!isValidEmail(email)) {
      throw new Error('Invalid email format')
    }
  }

  return values
}

/**
 * Normalize email to lowercase and trim
 */
const normalizeEmailValue: SystemHook = async ({ field, values }) => {
  const email = values[field.id]

  if (email && typeof email === 'string') {
    return {
      ...values,
      [field.id]: normalizeEmailUtil(email),
    }
  }

  return values
}

/**
 * Check email uniqueness for contact entities
 * Ensures no duplicate email addresses exist in the organization
 */
const checkEmailUniqueness: SystemHook = async ({
  field,
  values,
  entityDef,
  organizationId,
  existingInstance,
}) => {
  const email = values[field.id]

  // Skip if no email value provided
  if (!email || typeof email !== 'string') {
    return values
  }

  // Check uniqueness using checkUniqueValue
  const result = await checkUniqueValue({
    fieldId: field.id,
    value: email,
    organizationId,
    modelType: ModelTypes.ENTITY,
    entityDefinitionId: entityDef.id,
    excludeEntityId: existingInstance?.id,
  })

  if (result.isErr()) {
    throw new Error(`Email address already exists: ${email}`)
  }

  return values
}

/**
 * Validate contact status transitions
 * Ensures status field has valid values
 */
const validateContactStatus: SystemHook = async ({ field, values }) => {
  const status = values[field.id]

  if (status && typeof status === 'string') {
    const validStatuses = ['ACTIVE', 'INACTIVE', 'SPAM', 'MERGED']
    if (!validStatuses.includes(status.toUpperCase())) {
      throw new Error(`Invalid contact status: ${status}`)
    }

    // Normalize to uppercase
    return {
      ...values,
      [field.id]: status.toUpperCase(),
    }
  }

  return values
}

/**
 * Prevent direct updates to MERGED status
 * MERGED status should only be set through the merge operation
 */
const preventMergedStatus: SystemHook = async ({ field, values, operation }) => {
  const status = values[field.id]

  if (status && typeof status === 'string' && status.toUpperCase() === 'MERGED') {
    // Allow MERGED status on create (for merge operation), but prevent on update
    if (operation === 'update') {
      throw new Error('Cannot manually set contact status to MERGED. Use the merge operation instead.')
    }
  }

  return values
}

/**
 * Contact hooks registry
 * Maps system attributes to their validation/transformation hooks
 */
export const CONTACT_HOOKS: SystemHookRegistry = {
  // Primary email hooks - run in order: validate, normalize, check uniqueness
  primary_email: [validateEmailFormat, normalizeEmailValue, checkEmailUniqueness],

  // Contact status hooks - validate transitions and prevent manual MERGED status
  contact_status: [validateContactStatus, preventMergedStatus],
}
