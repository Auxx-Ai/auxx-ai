// packages/services/src/developer-accounts/check-developer-account-slug-exists.ts

import { database } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { DeveloperAccountError } from './errors'

/**
 * Check if a developer account slug is already taken
 *
 * @param input - Object containing the slug to check
 * @returns Result with exists flag and developer account ID if found
 */
export async function checkDeveloperAccountSlugExists(input: { slug: string }) {
  const { slug } = input

  const result = await fromDatabase(
    database.query.DeveloperAccount.findFirst({
      where: (accounts, { eq }) => eq(accounts.slug, slug),
      columns: {
        id: true,
      },
    }),
    'check-developer-account-slug-exists'
  )

  if (result.isErr()) {
    return result
  }

  const account = result.value

  return ok({
    exists: !!account,
    id: account?.id ?? null,
  })
}
