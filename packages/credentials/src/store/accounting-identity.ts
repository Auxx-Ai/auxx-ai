// packages/credentials/src/store/accounting-identity.ts
import { schema, type Transaction, withAccountingCommitLock } from '@auxx/database'
import { and, eq } from 'drizzle-orm'

/** Keep credential identity writes and accounting acceptance in the same lock order. */
export async function guardAccountingCredentialInTx(
  tx: Transaction,
  organizationId: string,
  credentialId: string,
  change:
    | { kind: 'metadata'; metadata: Record<string, unknown> }
    | { kind: 'delete' }
    | { kind: 'default'; appId: string }
): Promise<void> {
  await withAccountingCommitLock(tx, organizationId)
  if (change.kind === 'default') {
    const active = await tx.query.ExternalBookConnection.findFirst({
      where: and(
        eq(schema.ExternalBookConnection.organizationId, organizationId),
        eq(schema.ExternalBookConnection.state, 'active')
      ),
    })
    if (!active || active.credentialId === credentialId || !active.credentialId) return
    const bound = await tx.query.Credential.findFirst({
      where: and(
        eq(schema.Credential.organizationId, organizationId),
        eq(schema.Credential.id, active.credentialId)
      ),
      columns: { appId: true },
    })
    if (bound?.appId === change.appId) {
      throw new Error(
        'Change the accounting destination through explicit accounting cutover before changing this primary connection'
      )
    }
    return
  }
  if (change.kind === 'delete') {
    await tx
      .update(schema.ExternalBookConnection)
      .set({ state: 'disconnected' })
      .where(
        and(
          eq(schema.ExternalBookConnection.organizationId, organizationId),
          eq(schema.ExternalBookConnection.credentialId, credentialId),
          eq(schema.ExternalBookConnection.state, 'active')
        )
      )
    return
  }
  const bindings = await tx
    .select({
      providerKey: schema.ExternalAccountingBook.providerKey,
      companyId: schema.ExternalAccountingBook.externalCompanyId,
    })
    .from(schema.ExternalBookConnection)
    .innerJoin(
      schema.ExternalAccountingBook,
      and(
        eq(
          schema.ExternalAccountingBook.organizationId,
          schema.ExternalBookConnection.organizationId
        ),
        eq(schema.ExternalAccountingBook.id, schema.ExternalBookConnection.bookId)
      )
    )
    .where(
      and(
        eq(schema.ExternalBookConnection.organizationId, organizationId),
        eq(schema.ExternalBookConnection.credentialId, credentialId)
      )
    )
  for (const binding of bindings) {
    if (
      binding.providerKey === 'quickbooks' &&
      (typeof change.metadata.realmId !== 'string' ||
        change.metadata.realmId.trim() !== binding.companyId)
    ) {
      throw new Error(
        'An accounting credential cannot change its company identity; add a separate connection and use accounting cutover'
      )
    }
  }
}
