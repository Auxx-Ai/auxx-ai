// packages/services/src/apps/check-app-slug-exists.ts

import { database } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
// import type { AppError } from './errors'

/**
 * Check if an app slug is already taken
 *
 * @param input - Object containing the slug to check ff
 * @returns Result with exists flag and app ID if found
 */
export async function checkAppSlugExists(input: { slug: string }) {
  const { slug } = input

  const result = await fromDatabase(
    database.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.slug, slug),
      columns: {
        id: true,
      },
    }),
    'check-app-slug-exists'
  )

  if (result.isErr()) {
    return result
  }

  const app = result.value

  return ok({
    exists: !!app,
    id: app?.id ?? null,
  })
}
