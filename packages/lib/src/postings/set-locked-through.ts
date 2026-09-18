// packages/lib/src/postings/set-locked-through.ts
import { type Database, schema } from '@auxx/database'
import { recordAudit } from '../audit-log'
import { onCacheEvent } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { SETTINGS_CATALOG } from '../settings/catalog'
import { readOrganizationSettings } from '../settings/read'
import { withAccountingCommitLock } from './accounting-commit-lock'
import { PERIOD_LOCK_SETTING_KEY } from './period-lock'
import { parsePeriodKey } from './periods'

/** Authenticated command context. Permission checks belong to the entry point. */
export interface SetLockedThroughInput {
  organizationId: string
  periodKey: string | null
  actorUserId: string
  ipAddress?: string | null
  userAgent?: string | null
  sessionId?: string | null
}

/** Close or explicitly reopen months, recording the setting and audit in one transaction. */
export async function setLockedThrough(db: Database, input: SetLockedThroughInput): Promise<void> {
  if (input.periodKey !== null && parsePeriodKey(input.periodKey).granularity !== 'month') {
    throw new UnprocessableEntityError('The accounting lock must name a calendar month')
  }
  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, input.organizationId)
    // Read the exact pre-write value for the audit row below — the setting is
    // about to be overwritten in this same transaction, so the cached path
    // (which wouldn't see this transaction's world) is not an option here.
    const previous = await readOrganizationSettings(
      input.organizationId,
      [PERIOD_LOCK_SETTING_KEY] as const,
      tx
    )
    await tx
      .insert(schema.OrganizationSetting)
      .values({
        organizationId: input.organizationId,
        key: PERIOD_LOCK_SETTING_KEY,
        value: input.periodKey,
        scope: SETTINGS_CATALOG[PERIOD_LOCK_SETTING_KEY].scope,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
        set: { value: input.periodKey, updatedAt: new Date() },
      })
    await recordAudit(
      {
        organizationId: input.organizationId,
        category: 'settings',
        action: 'setting.changed',
        targetType: 'OrganizationSetting',
        targetId: PERIOD_LOCK_SETTING_KEY,
        actorType: 'user',
        actorId: input.actorUserId,
        previousState: { value: previous[PERIOD_LOCK_SETTING_KEY] },
        newState: { value: input.periodKey },
        context: {
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          sessionId: input.sessionId,
        },
      },
      tx
    )
  })
  await onCacheEvent('org.settings.changed', {
    orgId: input.organizationId,
    broadcastUserKeys: true,
  })
}
