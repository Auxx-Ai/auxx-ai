// scripts/dev-add-gog-calendar-user-def.ts
// One-shot dev helper: add a user-scope ConnectionDefinition for gog-calendar
// so the Personal section can be exercised end-to-end. Safe to re-run.

import { database, schema } from '@auxx/database'
import { createId } from '@paralleldrive/cuid2'
import { and, eq } from 'drizzle-orm'

async function main() {
  const orgDef = await database.query.ConnectionDefinition.findFirst({
    where: (cd, { and, eq }) => and(eq(cd.appId, 'txa68azxnw7s7jwicn0nekr5'), eq(cd.global, true)),
  })
  if (!orgDef) throw new Error('gog-calendar org-scope definition not found')

  const existingUser = await database.query.ConnectionDefinition.findFirst({
    where: (cd, { and, eq }) => and(eq(cd.appId, orgDef.appId), eq(cd.global, false)),
  })
  if (existingUser) {
    console.log('user-scope definition already exists:', existingUser.id)
    return
  }

  const [inserted] = await database
    .insert(schema.ConnectionDefinition)
    .values({
      id: createId(),
      appId: orgDef.appId,
      developerAccountId: orgDef.developerAccountId,
      major: orgDef.major,
      connectionType: orgDef.connectionType,
      label: 'Personal Google Calendar',
      description: 'Connect your personal Google Calendar.',
      global: false,
      oauth2AuthorizeUrl: orgDef.oauth2AuthorizeUrl,
      oauth2AccessTokenUrl: orgDef.oauth2AccessTokenUrl,
      oauth2Scopes: orgDef.oauth2Scopes,
      oauth2ClientId: orgDef.oauth2ClientId,
      oauth2ClientSecret: orgDef.oauth2ClientSecret,
      oauth2TokenRequestAuthMethod: orgDef.oauth2TokenRequestAuthMethod,
      oauth2RefreshTokenIntervalSeconds: orgDef.oauth2RefreshTokenIntervalSeconds,
      oauth2Features: {
        ...(orgDef.oauth2Features ?? {}),
        additionalAuthorizeParams: {
          ...((orgDef.oauth2Features ?? {}).additionalAuthorizeParams ?? {}),
          prompt: 'consent',
          access_type: 'offline',
        },
      },
      createdById: orgDef.createdById,
    })
    .returning()

  console.log('inserted user-scope definition for gog-calendar:', inserted.id)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
