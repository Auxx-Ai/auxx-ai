// packages/credentials/src/config/config-storage.ts

import type { KeyValuePairEntity } from '@auxx/database'
import { database as db, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { CredentialService } from '../service/credential-service'
import { getConfigDefinition } from './config-registry'

const CONFIG_TYPE = 'CONFIG_VARIABLE'

/**
 * DB storage layer for config variable overrides.
 * Queries KeyValuePair table scoped to type=CONFIG_VARIABLE.
 * Handles encryption/decryption of sensitive values.
 */
export class ConfigStorage {
  /**
   * Get all system-wide config overrides (orgId=NULL, userId=NULL)
   */
  async getAllSystem(): Promise<Array<{ key: string; value: unknown; isEncrypted: boolean }>> {
    const rows = await db
      .select()
      .from(schema.KeyValuePair)
      .where(
        and(
          eq(schema.KeyValuePair.type, CONFIG_TYPE),
          isNull(schema.KeyValuePair.organizationId),
          isNull(schema.KeyValuePair.userId)
        )
      )
      .orderBy(schema.KeyValuePair.key)

    return rows.map((row) => ({
      key: row.key,
      value: this.decryptIfNeeded(row),
      isEncrypted: row.isEncrypted === 'true',
    }))
  }

  /**
   * Get all config overrides for an organization
   */
  async getAllForOrg(
    organizationId: string
  ): Promise<Array<{ key: string; value: unknown; isEncrypted: boolean }>> {
    const rows = await db
      .select()
      .from(schema.KeyValuePair)
      .where(
        and(
          eq(schema.KeyValuePair.type, CONFIG_TYPE),
          eq(schema.KeyValuePair.organizationId, organizationId),
          isNull(schema.KeyValuePair.userId)
        )
      )
      .orderBy(schema.KeyValuePair.key)

    return rows.map((row) => ({
      key: row.key,
      value: this.decryptIfNeeded(row),
      isEncrypted: row.isEncrypted === 'true',
    }))
  }

  /**
   * Set (upsert) a system-wide config override
   */
  async setSystem(key: string, value: unknown, updatedById?: string): Promise<void> {
    const definition = getConfigDefinition(key)
    const shouldEncrypt = definition?.isSensitive ?? false

    const storedValue = shouldEncrypt ? CredentialService.encrypt({ value } as any) : value

    await db
      .insert(schema.KeyValuePair)
      .values({
        key,
        value: storedValue as any,
        type: CONFIG_TYPE,
        isEncrypted: shouldEncrypt ? 'true' : 'false',
        organizationId: null,
        userId: null,
        updatedById,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.KeyValuePair.key,
        targetWhere: sql`"userId" IS NULL AND "organizationId" IS NULL`,
        set: {
          value: storedValue as any,
          isEncrypted: shouldEncrypt ? 'true' : 'false',
          updatedById,
          updatedAt: new Date(),
        },
      })
  }

  /**
   * Delete a system-wide config override (revert to env/default)
   */
  async deleteSystem(key: string): Promise<void> {
    await db
      .delete(schema.KeyValuePair)
      .where(
        and(
          eq(schema.KeyValuePair.key, key),
          eq(schema.KeyValuePair.type, CONFIG_TYPE),
          isNull(schema.KeyValuePair.organizationId),
          isNull(schema.KeyValuePair.userId)
        )
      )
  }

  /**
   * Set (upsert) an org-level config override.
   * Uses unique index: (key, organizationId) WHERE userId IS NULL
   */
  async setForOrg(
    organizationId: string,
    key: string,
    value: unknown,
    updatedById?: string,
    tx?: Transaction
  ): Promise<void> {
    const definition = getConfigDefinition(key)
    const shouldEncrypt = definition?.isSensitive ?? false
    const storedValue = shouldEncrypt ? CredentialService.encrypt({ value } as any) : value

    await (tx ?? db)
      .insert(schema.KeyValuePair)
      .values({
        key,
        value: storedValue as any,
        type: CONFIG_TYPE,
        isEncrypted: shouldEncrypt ? 'true' : 'false',
        organizationId,
        userId: null,
        updatedById,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.KeyValuePair.key, schema.KeyValuePair.organizationId],
        targetWhere: sql`"userId" IS NULL`,
        set: {
          value: storedValue as any,
          isEncrypted: shouldEncrypt ? 'true' : 'false',
          updatedById,
          updatedAt: new Date(),
        },
      })
  }

  /**
   * Delete an org-level config override (revert to system/env/default).
   */
  async deleteForOrg(organizationId: string, key: string, tx?: Transaction): Promise<void> {
    await (tx ?? db)
      .delete(schema.KeyValuePair)
      .where(
        and(
          eq(schema.KeyValuePair.key, key),
          eq(schema.KeyValuePair.type, CONFIG_TYPE),
          eq(schema.KeyValuePair.organizationId, organizationId),
          isNull(schema.KeyValuePair.userId)
        )
      )
  }

  /**
   * Decrypt a row's value if it's encrypted
   */
  private decryptIfNeeded(row: KeyValuePairEntity): unknown {
    if (row.isEncrypted === 'true' && typeof row.value === 'string') {
      try {
        const decrypted = CredentialService.decrypt(row.value)
        return (decrypted as any).value
      } catch {
        return null // Decryption failed — treat as missing
      }
    }
    return row.value
  }
}
