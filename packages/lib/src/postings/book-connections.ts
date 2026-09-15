// packages/lib/src/postings/book-connections.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { ConflictError, UnprocessableEntityError } from '../errors'
import { withAccountingCommitLock } from './accounting-commit-lock'
import { canonicalAccountingJson } from './effect-basis'
import type { PostingDeliveryIntent } from './insert-posting'

const accountingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'A real calendar date is required')

/** Explicit, immutable external opening choice; a local period cutoff is not evidence. */
export const accountingOpeningPolicySchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('explicit_cutover'),
    exportFromDate: accountingDateSchema,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()

/** Authorized activation or company cutover. Expected null means no active destination. */
export interface ActivateAccountingBookConnectionInput {
  organizationId: string
  credentialId: string
  exportFromDate: string
  openingPolicy: z.infer<typeof accountingOpeningPolicySchema>
  actorUserId: string
  expectedActiveConnectionId: string | null
}

/** Non-secret binding used to invoke exactly the company saved on a posting. */
export interface PinnedAccountingConnection {
  connectionId: string
  bookId: string
  credentialId: string
  companyId: string
  providerKey: 'quickbooks'
  appInstallationId: string
}

/** Validate company metadata without coercing missing values into an identity. */
export function quickbooksCompanyId(metadata: unknown): string {
  const realmId =
    metadata && typeof metadata === 'object' && 'realmId' in metadata ? metadata.realmId : undefined
  if (typeof realmId !== 'string' || !realmId.trim()) {
    throw new UnprocessableEntityError(
      'QuickBooks company identity is missing; reconnect the workspace connection'
    )
  }
  return realmId.trim()
}

async function readCredentialInTx(tx: Transaction, organizationId: string, credentialId: string) {
  const credential = await tx.query.Credential.findFirst({
    where: and(
      eq(schema.Credential.organizationId, organizationId),
      eq(schema.Credential.id, credentialId)
    ),
    columns: {
      id: true,
      appId: true,
      appInstallationId: true,
      kind: true,
      userId: true,
      metadata: true,
    },
  })
  if (
    !credential ||
    credential.kind !== 'app' ||
    credential.userId !== null ||
    !credential.appId ||
    !credential.appInstallationId
  ) {
    throw new UnprocessableEntityError('Accounting requires an organization QuickBooks connection')
  }
  const app = await tx.query.App.findFirst({
    where: eq(schema.App.id, credential.appId),
    columns: { slug: true },
  })
  const installation = await tx.query.AppInstallation.findFirst({
    where: and(
      eq(schema.AppInstallation.id, credential.appInstallationId),
      eq(schema.AppInstallation.organizationId, organizationId),
      eq(schema.AppInstallation.appId, credential.appId),
      isNull(schema.AppInstallation.uninstalledAt)
    ),
    columns: { id: true },
  })
  if (app?.slug !== 'quickbooks' || !installation) {
    throw new UnprocessableEntityError('The QuickBooks accounting connection is not installed')
  }
  return {
    ...credential,
    appId: credential.appId,
    appInstallationId: installation.id,
    companyId: quickbooksCompanyId(credential.metadata),
  }
}

/** Read a pinned connection from authoritative rows, without changing its destination. */
export async function readPinnedAccountingConnectionInTx(
  tx: Transaction,
  organizationId: string,
  connectionId: string
): Promise<PinnedAccountingConnection> {
  await withAccountingCommitLock(tx, organizationId)
  const connection = await tx.query.ExternalBookConnection.findFirst({
    where: and(
      eq(schema.ExternalBookConnection.organizationId, organizationId),
      eq(schema.ExternalBookConnection.id, connectionId)
    ),
  })
  if (!connection || connection.state === 'disconnected' || !connection.credentialId) {
    throw new UnprocessableEntityError(
      'The journal destination is disconnected or retired; repair its original connection'
    )
  }
  const book = await tx.query.ExternalAccountingBook.findFirst({
    where: and(
      eq(schema.ExternalAccountingBook.organizationId, organizationId),
      eq(schema.ExternalAccountingBook.id, connection.bookId)
    ),
  })
  if (connection.state === 'retired') {
    const active = await tx.query.ExternalBookConnection.findFirst({
      where: and(
        eq(schema.ExternalBookConnection.organizationId, organizationId),
        eq(schema.ExternalBookConnection.state, 'active')
      ),
    })
    if (
      !active ||
      active.bookId !== connection.bookId ||
      active.credentialId !== connection.credentialId
    ) {
      throw new ConflictError(
        'Repair this historical connection using the active authorization for its original company'
      )
    }
  }
  const credential = await readCredentialInTx(tx, organizationId, connection.credentialId)
  if (
    !book ||
    book.providerKey !== 'quickbooks' ||
    book.externalCompanyId !== credential.companyId
  ) {
    throw new ConflictError('The credential no longer identifies the journal destination company')
  }
  return {
    connectionId,
    bookId: book.id,
    credentialId: credential.id,
    companyId: book.externalCompanyId,
    providerKey: 'quickbooks',
    appInstallationId: credential.appInstallationId,
  }
}

/** Resolve saved connectivity outside a caller transaction; performs no provider request. */
export async function readPinnedAccountingConnection(
  db: Database,
  organizationId: string,
  connectionId: string
): Promise<PinnedAccountingConnection> {
  return db.transaction((tx) =>
    readPinnedAccountingConnectionInTx(tx, organizationId, connectionId)
  )
}

/** Atomically adopt existing credentials or explicitly cut over to another company. */
export async function activateAccountingBookConnectionInTx(
  tx: Transaction,
  input: ActivateAccountingBookConnectionInput
) {
  const policy = accountingOpeningPolicySchema.parse(input.openingPolicy)
  if (policy.exportFromDate !== accountingDateSchema.parse(input.exportFromDate)) {
    throw new UnprocessableEntityError('The opening policy must name the exact export start date')
  }
  if (!input.actorUserId)
    throw new UnprocessableEntityError('An actor is required for accounting cutover')
  await withAccountingCommitLock(tx, input.organizationId)
  const credential = await readCredentialInTx(tx, input.organizationId, input.credentialId)
  const active = await tx.query.ExternalBookConnection.findFirst({
    where: and(
      eq(schema.ExternalBookConnection.organizationId, input.organizationId),
      eq(schema.ExternalBookConnection.state, 'active')
    ),
  })
  if (
    active?.credentialId === input.credentialId &&
    active.exportFromDate === input.exportFromDate &&
    canonicalAccountingJson(active.openingPolicy) === canonicalAccountingJson(policy)
  ) {
    await readPinnedAccountingConnectionInTx(tx, input.organizationId, active.id)
    return active
  }
  if ((active?.id ?? null) !== input.expectedActiveConnectionId) {
    throw new ConflictError(
      'The active accounting connection changed; review the current destination'
    )
  }
  let book = await tx.query.ExternalAccountingBook.findFirst({
    where: and(
      eq(schema.ExternalAccountingBook.organizationId, input.organizationId),
      eq(schema.ExternalAccountingBook.providerKey, 'quickbooks'),
      eq(schema.ExternalAccountingBook.externalCompanyId, credential.companyId)
    ),
  })
  if (!book) {
    ;[book] = await tx
      .insert(schema.ExternalAccountingBook)
      .values({
        organizationId: input.organizationId,
        providerKey: 'quickbooks',
        externalCompanyId: credential.companyId,
      })
      .returning()
  }
  if (!book) throw new Error('Failed to create accounting book identity')
  const previous = await tx.query.ExternalBookConnection.findFirst({
    where: and(
      eq(schema.ExternalBookConnection.organizationId, input.organizationId),
      eq(schema.ExternalBookConnection.bookId, book.id)
    ),
    orderBy: desc(schema.ExternalBookConnection.epoch),
  })
  if (active)
    await tx
      .update(schema.ExternalBookConnection)
      .set({ state: 'retired' })
      .where(eq(schema.ExternalBookConnection.id, active.id))
  const [connection] = await tx
    .insert(schema.ExternalBookConnection)
    .values({
      organizationId: input.organizationId,
      bookId: book.id,
      epoch: (previous?.epoch ?? 0) + 1,
      credentialId: credential.id,
      credentialOrganizationId: input.organizationId,
      credentialBindingSnapshot: canonicalAccountingJson({
        version: 1,
        providerKey: 'quickbooks',
        companyId: credential.companyId,
        credentialId: credential.id,
        appInstallationId: credential.appInstallationId,
      }),
      state: 'active',
      exportFromDate: input.exportFromDate,
      openingPolicy: policy,
    })
    .returning()
  if (!connection) throw new Error('Failed to create accounting connection identity')
  await tx
    .update(schema.Credential)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.Credential.organizationId, input.organizationId),
        eq(schema.Credential.appId, credential.appId),
        isNull(schema.Credential.userId),
        ne(schema.Credential.id, credential.id)
      )
    )
  await tx
    .update(schema.Credential)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.Credential.organizationId, input.organizationId),
        eq(schema.Credential.id, credential.id)
      )
    )
  await tx.insert(schema.AuditLog).values({
    organizationId: input.organizationId,
    category: 'settings',
    action: 'setting.changed',
    targetType: 'ExternalBookConnection',
    targetId: connection.id,
    actorType: 'user',
    actorId: input.actorUserId,
    previousState: { connectionId: active?.id ?? null },
    newState: {
      connectionId: connection.id,
      bookId: book.id,
      companyId: credential.companyId,
      openingPolicy: policy,
    },
  })
  return connection
}

/** Public transaction owner for the accounting setup/cutover command. */
export async function activateAccountingBookConnection(
  db: Database,
  input: ActivateAccountingBookConnectionInput
) {
  return db.transaction((tx) => activateAccountingBookConnectionInTx(tx, input))
}

/** Pin eligible fulfillment delivery; unbridged provider settings block instead of disappearing. */
export async function resolveFulfillmentDeliveryIntentInTx(
  tx: Transaction,
  organizationId: string,
  txnDate: string
): Promise<PostingDeliveryIntent> {
  accountingDateSchema.parse(txnDate)
  await withAccountingCommitLock(tx, organizationId)
  const active = await tx.query.ExternalBookConnection.findFirst({
    where: and(
      eq(schema.ExternalBookConnection.organizationId, organizationId),
      eq(schema.ExternalBookConnection.state, 'active')
    ),
  })
  if (active) {
    const policy = accountingOpeningPolicySchema.safeParse(active.openingPolicy)
    if (!policy.success || policy.data.exportFromDate !== active.exportFromDate) {
      throw new UnprocessableEntityError(
        'The accounting destination needs an explicit opening policy'
      )
    }
    await readPinnedAccountingConnectionInTx(tx, organizationId, active.id)
    if (txnDate < active.exportFromDate) return { kind: 'not_required' }
    const setting = await tx.query.OrganizationSetting.findFirst({
      where: and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        eq(schema.OrganizationSetting.key, 'quickbooks.postJournalEntries')
      ),
      columns: { value: true },
    })
    if (setting?.value != null && typeof setting.value !== 'boolean') {
      throw new UnprocessableEntityError('QuickBooks journal export configuration is invalid')
    }
    return { kind: setting?.value === true ? 'automatic' : 'manual', connectionId: active.id }
  }
  const books = await tx.query.ExternalAccountingBook.findMany({
    where: eq(schema.ExternalAccountingBook.organizationId, organizationId),
    columns: { id: true },
    limit: 1,
  })
  const apps = await tx.query.App.findMany({
    where: eq(schema.App.slug, 'quickbooks'),
    columns: { id: true },
  })
  const installation = apps.length
    ? await tx.query.AppInstallation.findFirst({
        where: and(
          eq(schema.AppInstallation.organizationId, organizationId),
          inArray(
            schema.AppInstallation.appId,
            apps.map((app) => app.id)
          ),
          isNull(schema.AppInstallation.uninstalledAt)
        ),
        columns: { id: true },
      })
    : undefined
  if (books.length || installation) {
    throw new UnprocessableEntityError(
      'Establish the QuickBooks accounting destination and explicit export start date before posting fulfillment accounting'
    )
  }
  return { kind: 'not_required' }
}

/** Disconnect accounting identities in the same transaction as an app uninstall. */
export async function disconnectAccountingInstallationInTx(
  tx: Transaction,
  organizationId: string,
  appInstallationId: string
): Promise<void> {
  await withAccountingCommitLock(tx, organizationId)
  const credentials = await tx.query.Credential.findMany({
    where: and(
      eq(schema.Credential.organizationId, organizationId),
      eq(schema.Credential.appInstallationId, appInstallationId)
    ),
    columns: { id: true },
  })
  if (credentials.length)
    await tx
      .update(schema.ExternalBookConnection)
      .set({ state: 'disconnected' })
      .where(
        and(
          eq(schema.ExternalBookConnection.organizationId, organizationId),
          eq(schema.ExternalBookConnection.state, 'active'),
          inArray(
            schema.ExternalBookConnection.credentialId,
            credentials.map((credential) => credential.id)
          )
        )
      )
}

/** Non-secret setup status and available organization QuickBooks authorizations. */
export async function readAccountingBookConnectionStatus(db: Database, organizationId: string) {
  const connections = await db
    .select({
      id: schema.ExternalBookConnection.id,
      bookId: schema.ExternalBookConnection.bookId,
      state: schema.ExternalBookConnection.state,
      epoch: schema.ExternalBookConnection.epoch,
      exportFromDate: schema.ExternalBookConnection.exportFromDate,
      credentialId: schema.ExternalBookConnection.credentialId,
      companyId: schema.ExternalAccountingBook.externalCompanyId,
      createdAt: schema.ExternalBookConnection.createdAt,
    })
    .from(schema.ExternalBookConnection)
    .innerJoin(
      schema.ExternalAccountingBook,
      and(
        eq(schema.ExternalAccountingBook.organizationId, organizationId),
        eq(schema.ExternalAccountingBook.id, schema.ExternalBookConnection.bookId)
      )
    )
    .where(eq(schema.ExternalBookConnection.organizationId, organizationId))
    .orderBy(desc(schema.ExternalBookConnection.createdAt))
    .limit(50)
  const credentials = await db
    .select({
      id: schema.Credential.id,
      label: schema.Credential.label,
      name: schema.Credential.name,
      metadata: schema.Credential.metadata,
    })
    .from(schema.Credential)
    .innerJoin(schema.App, eq(schema.App.id, schema.Credential.appId))
    .innerJoin(
      schema.AppInstallation,
      and(
        eq(schema.AppInstallation.id, schema.Credential.appInstallationId),
        eq(schema.AppInstallation.organizationId, organizationId),
        isNull(schema.AppInstallation.uninstalledAt)
      )
    )
    .where(
      and(
        eq(schema.Credential.organizationId, organizationId),
        eq(schema.Credential.kind, 'app'),
        isNull(schema.Credential.userId),
        eq(schema.App.slug, 'quickbooks')
      )
    )
  return {
    activeConnectionId: connections.find((c) => c.state === 'active')?.id ?? null,
    connections,
    credentials: credentials.map((c) => {
      let companyId: string | null = null
      try {
        companyId = quickbooksCompanyId(c.metadata)
      } catch {}
      return { id: c.id, label: c.label ?? c.name, companyId }
    }),
  }
}

/** Explicitly restore connectivity to the original company without changing accepted destinations or opening policy. */
export async function repairAccountingBookConnection(
  db: Database,
  input: {
    organizationId: string
    connectionId: string
    credentialId: string
    expectedActiveConnectionId: string | null
    actorUserId: string
    reason: string
  }
) {
  if (!input.actorUserId || !input.reason.trim())
    throw new UnprocessableEntityError('An actor and repair reason are required')
  return db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, input.organizationId)
    const target = await tx.query.ExternalBookConnection.findFirst({
      where: and(
        eq(schema.ExternalBookConnection.organizationId, input.organizationId),
        eq(schema.ExternalBookConnection.id, input.connectionId)
      ),
    })
    if (!target) throw new UnprocessableEntityError('Accounting connection not found')
    const book = await tx.query.ExternalAccountingBook.findFirst({
      where: and(
        eq(schema.ExternalAccountingBook.organizationId, input.organizationId),
        eq(schema.ExternalAccountingBook.id, target.bookId)
      ),
    })
    const credential = await readCredentialInTx(tx, input.organizationId, input.credentialId)
    if (
      !book ||
      book.providerKey !== 'quickbooks' ||
      book.externalCompanyId !== credential.companyId
    )
      throw new ConflictError('Repair must authorize the original QuickBooks company')
    const active = await tx.query.ExternalBookConnection.findFirst({
      where: and(
        eq(schema.ExternalBookConnection.organizationId, input.organizationId),
        eq(schema.ExternalBookConnection.state, 'active')
      ),
    })
    if ((active?.id ?? null) !== input.expectedActiveConnectionId)
      throw new ConflictError('The active accounting company changed; refresh before repairing')
    if (
      active &&
      (active.bookId !== target.bookId ||
        (active.id !== target.id && active.credentialId !== credential.id))
    )
      throw new ConflictError(
        'Repair requires the active authorization for this same QuickBooks company'
      )
    const state = active && active.id !== target.id ? ('retired' as const) : ('active' as const)
    const [repaired] = await tx
      .update(schema.ExternalBookConnection)
      .set({ credentialId: credential.id, credentialOrganizationId: input.organizationId, state })
      .where(
        and(
          eq(schema.ExternalBookConnection.organizationId, input.organizationId),
          eq(schema.ExternalBookConnection.id, target.id)
        )
      )
      .returning()
    await tx.insert(schema.AuditLog).values({
      organizationId: input.organizationId,
      category: 'settings',
      action: 'setting.changed',
      targetType: 'ExternalBookConnection',
      targetId: target.id,
      actorType: 'user',
      actorId: input.actorUserId,
      previousState: { credentialId: target.credentialId, state: target.state },
      newState: {
        credentialId: credential.id,
        state,
        reason: input.reason.trim(),
        companyId: book.externalCompanyId,
      },
    })
    return repaired!
  })
}
