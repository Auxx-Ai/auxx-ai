// packages/lib/src/postings/set-locked-through.ts
import { type Database, schema } from '@auxx/database'
import { onCacheEvent } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { SETTINGS_CATALOG } from '../settings/catalog'
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
    const previous = await tx.query.OrganizationSetting.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, input.organizationId), eq(t.key, PERIOD_LOCK_SETTING_KEY)),
    })
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
    await tx.insert(schema.AuditLog).values({
      organizationId: input.organizationId,
      category: 'settings',
      action: 'setting.changed',
      targetType: 'OrganizationSetting',
      targetId: PERIOD_LOCK_SETTING_KEY,
      actorType: 'user',
      actorId: input.actorUserId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      sessionId: input.sessionId,
      previousState: { value: previous?.value ?? null },
      newState: { value: input.periodKey },
    })
  })
  await onCacheEvent('org.settings.changed', {
    orgId: input.organizationId,
    broadcastUserKeys: true,
  })
}
