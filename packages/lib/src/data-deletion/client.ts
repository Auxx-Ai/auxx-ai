// packages/lib/src/data-deletion/client.ts
//
// Client-safe surface for the data-deletion module: the confirmation-code
// alphabet, the status-URL shape, and the three string unions that mirror
// `packages/database/src/db/schema/data-deletion-request.ts`.
//
// NOTE: no 'use client' directive. This file is imported by SERVER code too
// (the callback routes, `create.ts`, `execute.ts`); the directive would turn
// every export into a client-reference proxy there and break those imports.
// It must therefore import nothing server-only — `nanoid` is isomorphic.

import { customAlphabet } from 'nanoid'

/** `DataDeletionRequest.provider`. */
export const DATA_DELETION_PROVIDERS = ['facebook', 'instagram', 'shopify'] as const
export type DataDeletionProvider = (typeof DATA_DELETION_PROVIDERS)[number]

/**
 * `DataDeletionRequest.kind` — which contract fired. This is what `execute.ts`
 * branches on, and the two Meta kinds are deliberately NOT collapsed:
 * `deauthorize` means "I stopped using your app" (pause the channel, keep the
 * credentials and sync cursors), `data_deletion` means "erase what you hold on
 * me" (revoke the tokens, soft-delete the channel).
 */
export const DATA_DELETION_KINDS = [
  'data_deletion',
  'deauthorize',
  'customer_redact',
  'shop_redact',
  'customer_data_request',
] as const
export type DataDeletionKind = (typeof DATA_DELETION_KINDS)[number]

/** The two `kind`s that arrive on a Meta `signed_request` callback. */
export const META_DATA_DELETION_KINDS = ['data_deletion', 'deauthorize'] as const
export type MetaDataDeletionKind = (typeof META_DATA_DELETION_KINDS)[number]

/** `DataDeletionRequest.status`. */
export const DATA_DELETION_STATUSES = ['received', 'processing', 'completed', 'failed'] as const
export type DataDeletionStatus = (typeof DATA_DELETION_STATUSES)[number]

/**
 * Meta requires the confirmation code to be alphanumeric, so the default
 * `nanoid` alphabet (which contains `-` and `_`) is not usable. Lowercase +
 * digits, defined in exactly ONE place so the route, the job, the status page,
 * and {@link isValidConfirmationCode} cannot drift apart.
 */
export const CONFIRMATION_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 24 chars of a 36-symbol alphabet — ~124 bits, unguessable and URL-clean. */
export const CONFIRMATION_CODE_LENGTH = 24

const nanoCode = customAlphabet(CONFIRMATION_CODE_ALPHABET, CONFIRMATION_CODE_LENGTH)

/**
 * Mint a public confirmation code. Never a uuid, never the row's primary key:
 * the code is handed to Meta and appears in a URL an unauthenticated stranger
 * loads, so it must be opaque to the pk keyspace.
 */
export function generateConfirmationCode(): string {
  return nanoCode()
}

/**
 * Cheap shape check before hitting the DB from the public status page — keeps a
 * junk path segment from turning into a query.
 */
export function isValidConfirmationCode(code: string): boolean {
  return new RegExp(`^[${CONFIRMATION_CODE_ALPHABET}]{${CONFIRMATION_CODE_LENGTH}}$`).test(code)
}

/** Path segment of the public status page. Mirrors `apps/web`'s `(public)` route. */
export const DATA_DELETION_STATUS_PATH = '/data-deletion'

/**
 * Build the status URL returned to Meta alongside the confirmation code.
 *
 * `baseUrl` is passed in rather than read from config so this file stays free
 * of server-only imports. Callers pass `WEBAPP_URL`. Meta's dashboard validator
 * rejects plain HTTP, so the base must be https in every deployed environment.
 */
export function buildDataDeletionStatusUrl(baseUrl: string, confirmationCode: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${DATA_DELETION_STATUS_PATH}/${confirmationCode}`
}
