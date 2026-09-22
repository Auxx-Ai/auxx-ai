// packages/lib/src/accounting/work-items/refusal.ts

import { AuxxError, NotFoundError } from '../../errors'
import type { PostResult } from '../ledger/types'
import { isWorkItemCode, type WorkItemCode } from './codes'

/** A refusal as a work item stores it: a code and its wake keys, never prose outside `REFUSED`. */
export interface WorkItemRefusal {
  reasonCode: WorkItemCode
  role?: string | null
  railId?: string | null
  glAccountId?: string | null
  periodKey?: string | null
  externalRef?: string | null
  detail?: Record<string, unknown>
}

/** The `details` key a thrower sets to name its own code. */
export const WORK_ITEM_CODE_DETAIL = 'workItemCode'

/** Tag an `AuxxError`'s details with a work-item code, for a throw site that knows its refusal. */
export function withWorkItemCode(code: WorkItemCode): { [WORK_ITEM_CODE_DETAIL]: WorkItemCode } {
  return { [WORK_ITEM_CODE_DETAIL]: code }
}

function firstRole(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null
  const roles = (details as Record<string, unknown>).unresolvedRoles
  if (Array.isArray(roles) && typeof roles[0] === 'string') return roles[0]
  return null
}

function allRoles(details: unknown): string[] | undefined {
  if (!details || typeof details !== 'object') return undefined
  const roles = (details as Record<string, unknown>).unresolvedRoles
  return Array.isArray(roles)
    ? roles.filter((role): role is string => typeof role === 'string')
    : undefined
}

/**
 * A poster's thrown refusal as a code. Reads the thrower's tag first, then the
 * role resolver's structured details; anything else is `REFUSED` with its message.
 */
export function refusalFromError(
  error: unknown,
  keys: Pick<WorkItemRefusal, 'railId' | 'periodKey'> = {}
): WorkItemRefusal {
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof AuxxError ? error.details : undefined
  const tagged = details?.[WORK_ITEM_CODE_DETAIL]
  if (isWorkItemCode(tagged)) return { reasonCode: tagged, ...keys }
  const role = firstRole(details)
  if (role) {
    return {
      reasonCode: 'ROLE_UNMAPPED',
      role,
      railId: keys.railId ?? null,
      detail: { roles: allRoles(details) },
    }
  }
  if (error instanceof NotFoundError) return { reasonCode: 'SOURCE_NOT_FOUND', ...keys }
  return { reasonCode: 'REFUSED', ...keys, detail: { message } }
}

/** `postEntry`'s refusal as a code; the entry's own month and rail are the wake keys. */
export function refusalFromPost(
  post: Pick<PostResult, 'status' | 'error' | 'items'>,
  keys: { railId?: string | null; periodKey?: string | null } = {}
): WorkItemRefusal {
  switch (post.status) {
    case 'account_unmapped': {
      const roles = (post.items ?? [])
        .filter((item) => item.key === 'unmapped_role' && item.ref)
        .map((item) => item.ref as string)
      return {
        reasonCode: 'ROLE_UNMAPPED',
        role: roles[0] ?? null,
        railId: keys.railId ?? null,
        detail: roles.length > 1 ? { roles } : {},
      }
    }
    case 'account_invalid':
      return { reasonCode: 'ACCOUNT_INVALID', detail: { message: post.error } }
    case 'period_closed':
      return { reasonCode: 'PERIOD_LOCKED', periodKey: keys.periodKey ?? null }
    case 'unbalanced':
      return { reasonCode: 'UNBALANCED' }
    case 'setup_incomplete':
      return { reasonCode: 'SETUP_INCOMPLETE' }
    case 'nothing_to_recognise':
      return { reasonCode: 'NOTHING_TO_RECOGNISE' }
    case 'error':
      return { reasonCode: 'TRANSIENT_ERROR', detail: { message: post.error } }
    default:
      return {
        reasonCode: 'REFUSED',
        detail: { message: post.error ?? `The ledger answered ${post.status}` },
      }
  }
}
