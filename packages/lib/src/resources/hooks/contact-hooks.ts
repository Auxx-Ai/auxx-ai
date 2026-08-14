// packages/lib/src/resources/hooks/contact-hooks.ts

import { checkUniqueValue } from '@auxx/services/custom-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import { formatEmail, isValidEmail } from '@auxx/utils/email'
import { BadRequestError, UniqueValueConflictError } from '../../errors'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Read the submitted email value(s) as a flat list of string candidates.
 * Multi-value writes (`options.multi`) arrive as arrays; single writes as a
 * scalar. Non-string / empty entries are passed through untouched here — the
 * typed write path's zod validation is the authority on those.
 */
function emailCandidates(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/**
 * Validate email format for primary_email field — every value of an array write.
 */
const validateEmailFormat: SystemHook = async ({ field, values }) => {
  for (const email of emailCandidates(values[field.id])) {
    if (!isValidEmail(email)) {
      throw new BadRequestError(`Invalid email format: ${email}`)
    }
  }

  return values
}

/**
 * Normalize email to lowercase and trim. Deliberately NOT normalizeEmail — that
 * canonicalizes Gmail plus-aliases/dots for comparison and must not rewrite the
 * stored address (a+x@gmail.com is the address the customer actually uses).
 *
 * Lowercasing here is load-bearing: `normalizeForLookup` assumes stored values
 * are write-normalized. Array writes additionally get an in-record
 * case-insensitive dedupe (first occurrence wins, order preserved) — nothing
 * downstream dedupes case-variants of the same address.
 */
const normalizeEmailValue: SystemHook = async ({ field, values }) => {
  const email = values[field.id]

  if (Array.isArray(email)) {
    const seen = new Set<string>()
    const normalized: unknown[] = []
    for (const v of email) {
      const formatted = typeof v === 'string' && v ? formatEmail(v) : v
      if (typeof formatted === 'string') {
        if (seen.has(formatted)) continue
        seen.add(formatted)
      }
      normalized.push(formatted)
    }
    return { ...values, [field.id]: normalized }
  }

  if (email && typeof email === 'string') {
    return {
      ...values,
      [field.id]: formatEmail(email),
    }
  }

  return values
}

/**
 * Check email uniqueness for contact entities — per value, org-wide.
 *
 * Every submitted value (array or scalar) must be unique across ALL contacts'
 * email rows in the org, excluding the record being written and excluding
 * archived records (merge archives sources whose FieldValue rows survive — see
 * `checkUniqueValue`). Throws `UniqueValueConflictError` carrying the offending
 * value so per-value writers (import, connector sink) can drop just that value.
 */
const checkEmailUniqueness: SystemHook = async ({
  field,
  values,
  entityDef,
  organizationId,
  existingInstance,
}) => {
  for (const email of emailCandidates(values[field.id])) {
    const result = await checkUniqueValue({
      fieldId: field.id,
      value: email,
      organizationId,
      modelType: ModelTypes.ENTITY,
      entityDefinitionId: entityDef.id,
      excludeEntityId: existingInstance?.id,
    })

    if (result.isErr()) {
      const violation = result.error
      const owner = violation.existingDisplayName ? ` on "${violation.existingDisplayName}"` : ''
      throw new UniqueValueConflictError({
        message: `Email address already exists${owner}: ${email}`,
        conflictingValue: email,
        fieldId: field.id,
        existingEntityId: violation.existingEntityId,
      })
    }
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
      throw new Error(
        'Cannot manually set contact status to MERGED. Use the merge operation instead.'
      )
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
