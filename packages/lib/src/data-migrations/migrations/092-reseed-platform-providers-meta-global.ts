// packages/lib/src/data-migrations/migrations/092-reseed-platform-providers-meta-global.ts

import { type Database, sql } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { ensurePlatformProviders } from '../../connections/providers'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-092')

/**
 * Apply #1721's `global: true` flip on the `facebook` / `instagram` connection
 * definitions, and re-scope the credentials the old flag produced.
 *
 * **This is the deploy step that fails silently.** `PLATFORM_PROVIDER_DEFS` is a
 * code catalog that is only ever read at seed time — `ensurePlatformProviders`
 * bakes the row, including `global` and the scope list, into
 * `ConnectionDefinition`. Editing defs.ts and deploying changes nothing at all:
 * every environment keeps serving whatever was baked the last time a reseed ran,
 * with no error anywhere to say so. Same reason 025, 038 and 089 exist.
 *
 * What the flip fixes, from the FB/IG plan's WS8: with `global: false` the OAuth
 * callback mints a **USER-scoped** credential (`userId: personal ? userId :
 * global ? null : userId`), the connections list then derives `scope: 'user'`,
 * and `buildConnectionVerify`'s matcher — which requires `r.scope === a.scope` —
 * can never match the `organization` connect the dialog believes it ran. The
 * dialog spins on "Connecting…" for a connect that already succeeded.
 *
 * **The second half is not optional, and it is the dangerous one.**
 * `resolve-connection-for-runtime.ts` does `scopedUserId = def.global ? null :
 * userId` and `findCredential` maps `userId: null` to `userId IS NULL`, so a
 * credential written under the old flag **stops resolving the moment the
 * definition flips** — the channel goes dead with no error. Any environment
 * holding an FB/IG credential needs both halves or it is worse off than before.
 *
 * `metadata.personal` rows are left alone: a personal connect is legitimately
 * user-scoped, and `personal` is evaluated before `global` on every path. No
 * FB/IG credential should carry it today (personal connects are gated to
 * email-like channels), which is exactly why it costs nothing to honour.
 *
 * Idempotent: the reseed SELECTs by `(providerKey, major)` and UPDATEs in place
 * so row ids — and the `Credential.connectionDefinitionId` FKs pointing at them
 * — survive; the credential update matches only rows still carrying a `userId`.
 */
export const migration092ReseedPlatformProvidersMetaGlobal: DataMigrationDef = {
  id: '092-reseed-platform-providers-meta-global',
  description:
    'Reseed platform connection providers (Meta global flag) and re-scope FB/IG credentials',
  async run(db: Database): Promise<void> {
    await ensurePlatformProviders(db)

    // Org-scoped is what `global: true` means, and what the runtime now looks for.
    // `createdById` is deliberately untouched — it is the audit trail of who
    // connected the page, and it is not what scopes the credential.
    const rescoped = await db.execute<{ id: string }>(sql`
      UPDATE "Credential" AS c
         SET "userId" = NULL
        FROM "ConnectionDefinition" AS d
       WHERE c."connectionDefinitionId" = d."id"
         AND d."providerKey" IN ('facebook', 'instagram')
         AND c."userId" IS NOT NULL
         AND COALESCE(c."metadata" ->> 'personal', 'false') <> 'true'
      RETURNING c."id"
    `)

    logger.info('Reseeded Meta connection definitions', {
      credentialsRescoped: rescoped.rows?.length ?? 0,
    })
  },
}
