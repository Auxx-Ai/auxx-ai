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

/** The wake keys (and a message for a code that renders one) a tagged throw can carry. */
export interface WorkItemTagKeys {
  role?: string | null
  railId?: string | null
  externalRef?: string | null
  message?: string | null
  /** Stored as the row's `detail`, beside `message`. */
  detail?: Record<string, unknown> | null
}

// `AuxxErrorDetails` holds only strings, so the keys ride flat beside the code.
const TAG_KEYS = {
  role: 'workItemRole',
  railId: 'workItemRailId',
  externalRef: 'workItemExternalRef',
  message: 'workItemMessage',
} as const

const DETAIL_KEY = 'workItemDetail'

/** Tag an `AuxxError`'s details with a work-item code, for a throw site that knows its refusal. */
export function withWorkItemCode(
  code: WorkItemCode,
  keys: WorkItemTagKeys = {}
): Record<string, string> {
  const details: Record<string, string> = { [WORK_ITEM_CODE_DETAIL]: code }
  for (const [key, detailKey] of Object.entries(TAG_KEYS)) {
    const value = keys[key as keyof WorkItemTagKeys]
    if (value && typeof value === 'string') details[detailKey] = value
  }
  if (keys.detail) details[DETAIL_KEY] = JSON.stringify(keys.detail)
  return details
}

function parseDetail(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function taggedKeys(details: Record<PropertyKey, unknown>): Partial<WorkItemRefusal> {
  const read = (key: string) => (typeof details[key] === 'string' ? (details[key] as string) : null)
  const role = read(TAG_KEYS.role)
  const railId = read(TAG_KEYS.railId)
  const externalRef = read(TAG_KEYS.externalRef)
  const message = read(TAG_KEYS.message)
  const detail = { ...parseDetail(read(DETAIL_KEY)), ...(message ? { message } : {}) }
  return {
    ...(role ? { role } : {}),
    ...(railId ? { railId } : {}),
    ...(externalRef ? { externalRef } : {}),
    ...(Object.keys(detail).length > 0 ? { detail } : {}),
  }
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
  if (isWorkItemCode(tagged)) return { reasonCode: tagged, ...keys, ...taggedKeys(details!) }
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
