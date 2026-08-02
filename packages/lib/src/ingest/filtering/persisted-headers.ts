// packages/lib/src/ingest/filtering/persisted-headers.ts

import { pickBulkMailHeaders } from './bulk-mail'
import { pickMachineMailHeaders } from './machine-mail'

/**
 * The header subset the providers that don't persist full headers (Outlook, IMAP)
 * store in `Message.metadata.headers`: the machine-mail allowlist and the bulk-mail
 * allowlist, merged.
 *
 * Two pickers over one header list rather than one grown allowlist —
 * `MACHINE_MAIL_HEADER_ALLOWLIST` is the documented input contract of
 * `detectMachineMail` and must not grow headers it does not read
 * (`threading-headers.ts:24`). Where the two overlap (`list-id`,
 * `list-unsubscribe`) both resolve the same first-occurrence value, so merge order
 * is irrelevant.
 *
 * Returns `undefined` when neither picker matched anything, so a header-less
 * message does not start persisting an empty `headers: {}`.
 */
export function pickPersistedHeaders(
  entries: Array<{ name?: string | null; key?: string | null; value?: string | null }> | undefined
): Record<string, string> | undefined {
  const machine = pickMachineMailHeaders(entries)
  const bulk = pickBulkMailHeaders(entries)
  if (!machine && !bulk) return undefined
  return { ...machine, ...bulk }
}
