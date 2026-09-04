// packages/lib/src/banking/feed/provision.ts

/**
 * Turning one authenticated Financial Connections account into a working feed: the
 * `bank_account` record, the `DataConnector` row, its two streams and their mappings.
 *
 * 🛑 **Contributing mode on both mappings, and `orphanBehavior: 'ignore'`**
 * (plans/bank-connection/02 §5.1). `bank_transaction` is a system def owned by auxx and
 * the feed contributes into it with per-field ownership, so orphan-archive is
 * structurally unavailable. A reconciliation sweep that archived a row because it fell
 * out of the upstream 180-day window would be deleting a posted journal entry's source
 * document. Both streams are also declared `incremental`, which is the second lock on
 * the same door: `reconcileOrphans` never archives on absence for an incremental
 * stream except on an explicit sweep.
 *
 * 🛑 **The `bank_account` row is created HERE, by auxx, and the connector then adopts
 * it.** The alternative - letting the first sync create it - leaves the settings page
 * showing an account with no connector for as long as the first slice chain takes, and
 * leaves `connectorId` (which is how every read joins health, and how the reaper finds
 * anything) written by nobody. So auxx writes the identity and the pointer, and the
 * `accounts` stream re-identifies the row by `connectorId` with an identity `match`,
 * contributing what the bank says on top. Everything the CONNECTOR owns still goes
 * through the entity sink, which stays the only writer of connector-owned values.
 *
 * No permission checks. The router asserts `ledgerPost` (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../../cache'
import {
  FC_ACCOUNTS_STREAM,
  FC_TRANSACTIONS_STREAM,
  STRIPE_FC_CONNECTOR_TYPE,
} from '../../data-connectors/connectors/stripe-financial-connections'
import {
  addMapping,
  addStream,
  createConnector,
  updateConnector,
} from '../../data-connectors/mutations'
import type { FieldMapping } from '../../data-connectors/types'
import { UnprocessableEntityError } from '../../errors'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { getOrganizationSetting } from '../../settings/settings-service'
import { requireBankAccountFieldContext } from '../reads'

const logger = createScopedLogger('banking-feed')

/** Stripe's API origin. Never called by this connector, but `getConnectorReadiness`
 *  refuses a connector with no endpoint, and naming the host it really talks to is a
 *  truer answer than a placeholder. */
const STRIPE_API_BASE_URL = 'https://api.stripe.com/v1'

/** What the bank told us about one account, as `complete()` shaped it. */
export interface BankFeedAccountFacts {
  /** The `fca_...` id. */
  providerAccountId: string
  institution: string | null
  name: string
  last4: string | null
  type: 'depository' | 'credit'
  currency: string
  /** The account is `active` at Stripe and the subscription took. */
  ready: boolean
}

export interface ProvisionBankFeedInput {
  organizationId: string
  actorUserId: string
  credentialId: string
  facts: BankFeedAccountFacts
}

export interface ProvisionedBankFeed {
  bankAccountId: string
  connectorId: string
  /** True when an existing account/connector pair was reused rather than created. */
  reconnected: boolean
}

/**
 * Create (or repair) the `bank_account` + `DataConnector` pair for one FC account.
 *
 * Idempotent on `providerAccountId`: reconnecting a bank already connected finds the
 * existing connector through the credential and re-arms it instead of standing up a
 * second feed beside the first, which would double every transaction in the review
 * queue.
 */
export async function provisionBankFeed(
  db: Database,
  input: ProvisionBankFeedInput
): Promise<ProvisionedBankFeed> {
  const { organizationId, actorUserId, credentialId, facts } = input

  const bankAccountDefId = await getCachedEntityDefId(organizationId, 'bank_account')
  const bankTransactionDefId = await getCachedEntityDefId(organizationId, 'bank_transaction')
  if (!bankAccountDefId || !bankTransactionDefId) {
    throw new UnprocessableEntityError(
      'Bank accounts are not available until the bank account and bank transaction entities ' +
        'are provisioned (entity migration 125)'
    )
  }

  const existing = await db.query.DataConnector.findFirst({
    where: (dc, { and, eq: e }) =>
      and(
        e(dc.organizationId, organizationId),
        e(dc.type, STRIPE_FC_CONNECTOR_TYPE),
        e(dc.credentialId, credentialId)
      ),
  })
  if (existing) {
    const repaired = await repairBankFeed(db, {
      organizationId,
      actorUserId,
      connectorId: existing.id,
      bankAccountDefId,
      facts,
    })
    return { ...repaired, reconnected: true }
  }

  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  const created = await crud.create(bankAccountDefId, {
    bank_account_name: facts.name,
    bank_account_institution: facts.institution ?? undefined,
    bank_account_last4: facts.last4 ?? undefined,
    bank_account_type: facts.type,
    bank_account_currency: facts.currency,
    bank_account_status: facts.ready ? 'connected' : 'disconnected',
  })
  const bankAccountId = created.instance.id
  const bankAccountRecordId = toRecordId(bankAccountDefId, bankAccountId)

  const connector = await createConnector(db, organizationId, {
    name: [facts.institution, facts.name].filter(Boolean).join(' · ') || 'Bank feed',
    type: STRIPE_FC_CONNECTOR_TYPE,
    credentialId,
    createdById: actorUserId,
    // Scheduled, not `webhook`. Stripe's `refreshed_transactions` webhook is what makes
    // the feed prompt (`applyStripeEvent` enqueues a sync on it), but a connector whose
    // ONLY door is a webhook is one misconfigured Dashboard endpoint away from a feed
    // that silently never runs - which is the most expensive bug in this subsystem. The
    // schedule is the floor; the webhook is the speed.
    syncBehavior: 'scheduled',
    scheduleConfig: { triggerInterval: 'hours', timeBetweenTriggers: { hours: 12 } },
    config: {
      endpoint: { baseUrl: STRIPE_API_BASE_URL, auth: 'none' },
      filters: {
        financialConnections: {
          accountId: facts.providerAccountId,
          bankAccountRecordId,
          // Stamped again below - the connector row has no id until it exists.
          connectorId: '',
          bookTimeZone: await readBookTimeZone(organizationId),
        },
      },
    },
  })

  // The second write. `connectorId` is both the `bank_account` pointer and the identity
  // `match` value the accounts stream re-identifies its row by, so it has to be inside
  // the connector's own config, and it cannot be until the row exists.
  const filters = (connector.config?.filters?.financialConnections ?? {}) as Record<string, unknown>
  await updateConnector(db, organizationId, connector.id, {
    config: {
      ...connector.config,
      filters: {
        financialConnections: { ...filters, connectorId: connector.id },
      },
    },
  })

  await crud.update(bankAccountRecordId, { bank_account_connector_id: connector.id })

  await buildStreams(db, {
    organizationId,
    connectorId: connector.id,
    bankAccountDefId,
    bankTransactionDefId,
  })

  logger.info('Provisioned a bank feed', {
    organizationId,
    bankAccountId,
    connectorId: connector.id,
    providerAccountId: facts.providerAccountId,
  })
  return { bankAccountId, connectorId: connector.id, reconnected: false }
}

/** Re-arm an existing feed after a reconnect: status back to live, facts refreshed. */
async function repairBankFeed(
  db: Database,
  args: {
    organizationId: string
    actorUserId: string
    connectorId: string
    bankAccountDefId: string
    facts: BankFeedAccountFacts
  }
): Promise<{ bankAccountId: string; connectorId: string }> {
  const { organizationId, actorUserId, connectorId, bankAccountDefId, facts } = args

  // 🛑 `disconnected` is load-bearing state, not a label. Moving OFF it is the whole
  // point of a reconnect, and moving off it any OTHER way is what removes a connector
  // from every repair path there is.
  await db
    .update(schema.DataConnector)
    .set({ status: 'pending', error: null })
    .where(eq(schema.DataConnector.id, connectorId))

  // 🛑 Scoped to the connector-id FIELD, never `valueText` alone. Every TEXT cell in the
  // org lives in one table, so an unfielded match on a cuid would happily return some
  // other entity's cell and repair the wrong record.
  const ctx = await requireBankAccountFieldContext(organizationId)
  const connectorField = ctx.fields.bank_account_connector_id
  const bankAccount = connectorField
    ? await db.query.FieldValue.findFirst({
        where: (fv, { and, eq: e }) =>
          and(
            e(fv.organizationId, organizationId),
            e(fv.fieldId, connectorField.id),
            e(fv.valueText, connectorId)
          ),
        columns: { entityId: true },
      })
    : null
  if (!bankAccount) {
    throw new UnprocessableEntityError(
      'This bank connection has a connector but no bank account record. Disconnect it and connect the bank again.'
    )
  }

  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  await crud.update(toRecordId(bankAccountDefId, bankAccount.entityId), {
    bank_account_status: facts.ready ? 'connected' : 'disconnected',
  })
  return { bankAccountId: bankAccount.entityId, connectorId }
}

/** The org's book timezone, or UTC. See `FinancialConnectionsFilters.bookTimeZone`. */
async function readBookTimeZone(organizationId: string): Promise<string> {
  const setting = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  return typeof setting === 'string' && setting.trim() ? setting.trim() : 'UTC'
}

/** Both streams and their mappings, in the shape the sink expects. */
async function buildStreams(
  db: Database,
  args: {
    organizationId: string
    connectorId: string
    bankAccountDefId: string
    bankTransactionDefId: string
  }
): Promise<void> {
  const { organizationId, connectorId, bankAccountDefId, bankTransactionDefId } = args

  const accountFields = await fieldIdsBySystemAttribute(organizationId, bankAccountDefId)
  const transactionFields = await fieldIdsBySystemAttribute(organizationId, bankTransactionDefId)

  const accountsStream = await addStream(db, organizationId, connectorId, {
    streamKey: FC_ACCOUNTS_STREAM,
    schemaSource: 'catalog',
    // 🛑 `incremental`, not `snapshot`. Snapshot means "absence is deletion", and this
    // feed must never be able to archive a bank account.
    syncMode: 'incremental',
    requestConfig: { path: '/financial_connections/accounts', method: 'GET' },
    sourceSchema: ACCOUNTS_SOURCE_SCHEMA,
  })
  await addMapping(db, organizationId, {
    dataConnectorStreamId: accountsStream.id,
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: bankAccountDefId,
    orphanBehavior: 'ignore',
    fieldMappings: buildFieldMappings(bankAccountDefId, accountFields, [
      // The identity `match`: adopt the row auxx already created for this connector
      // rather than creating a second bank account beside it on the first sync.
      { source: 'connectorId', attribute: 'bank_account_connector_id', match: true },
      { source: 'institution', attribute: 'bank_account_institution' },
      { source: 'name', attribute: 'bank_account_name' },
      { source: 'last4', attribute: 'bank_account_last4' },
      { source: 'type', attribute: 'bank_account_type' },
      { source: 'currency', attribute: 'bank_account_currency' },
      { source: 'status', attribute: 'bank_account_status' },
    ]),
  })

  const transactionsStream = await addStream(db, organizationId, connectorId, {
    streamKey: FC_TRANSACTIONS_STREAM,
    schemaSource: 'catalog',
    syncMode: 'incremental',
    requestConfig: { path: '/financial_connections/transactions', method: 'GET' },
    sourceSchema: TRANSACTIONS_SOURCE_SCHEMA,
  })
  await addMapping(db, organizationId, {
    dataConnectorStreamId: transactionsStream.id,
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: bankTransactionDefId,
    orphanBehavior: 'ignore',
    fieldMappings: buildFieldMappings(bankTransactionDefId, transactionFields, [
      {
        source: 'externalId',
        attribute: 'bank_transaction_external_id',
        externalId: true,
      },
      { source: 'bankAccountRecordId', attribute: 'bank_transaction_bank_account' },
      { source: 'postedAt', attribute: 'bank_transaction_posted_at' },
      { source: 'description', attribute: 'bank_transaction_description' },
      { source: 'amountMinor', attribute: 'bank_transaction_amount' },
      { source: 'bankStatus', attribute: 'bank_transaction_bank_status' },
      { source: 'matchKey', attribute: 'bank_transaction_match_key' },
      { source: 'source', attribute: 'bank_transaction_source' },
    ]),
  })
}

/** One binding, before it becomes a `FieldMapping`. */
interface Binding {
  source: string
  attribute: string
  match?: boolean
  externalId?: boolean
}

/**
 * Bindings → the CALC `fieldMappings` jsonb, in the shape the manual editor produces:
 * `sourceFields` is an identity map and the expression references the token as `{path}`.
 *
 * A binding whose target attribute the org's def does not carry is DROPPED with a
 * warning rather than throwing. An org mid-migration should get a feed that writes the
 * seven fields it has, not a connect button that fails.
 */
function buildFieldMappings(
  entityDefinitionId: string,
  fieldIds: Map<string, string>,
  bindings: Binding[]
): FieldMapping[] {
  const mappings: FieldMapping[] = []
  for (const binding of bindings) {
    const fieldId = fieldIds.get(binding.attribute)
    if (!fieldId) {
      logger.warn('Bank feed binding skipped - the entity has no such field', binding)
      continue
    }
    const mapping: FieldMapping = {
      id: generateId(),
      targetFieldRef: toResourceFieldId(entityDefinitionId, fieldId),
      expression: `{${binding.source}}`,
      sourceFields: { [binding.source]: binding.source },
    }
    if (binding.externalId) mapping.identityRole = { kind: 'externalId', order: 0 }
    if (binding.match) mapping.identityRole = { kind: 'match', normalize: 'none' }
    mappings.push(mapping)
  }
  return mappings
}

/** `systemAttribute` → concrete `CustomField.id` for one def. */
async function fieldIdsBySystemAttribute(
  organizationId: string,
  entityDefinitionId: string
): Promise<Map<string, string>> {
  const fields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const byAttribute = new Map<string, string>()
  for (const field of fields) {
    if (field.systemAttribute) byAttribute.set(field.systemAttribute, field.id)
  }
  return byAttribute
}

/**
 * The source schemas.
 *
 * They describe what the CONNECTOR emits (a pre-shaped flat object per record), not a
 * Stripe response body, because this connector pre-shapes: `matchKey` is normalised and
 * `postedAt` is converted into the org's book timezone inside `fetch()`, neither of
 * which a CALC expression can do. `getConnectorReadiness` refuses a stream with an empty
 * schema, and the mapping editor renders this tree.
 */
const ACCOUNTS_SOURCE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    externalId: { type: 'string' },
    connectorId: { type: 'string' },
    institution: { type: 'string' },
    name: { type: 'string' },
    last4: { type: 'string' },
    type: { type: 'string' },
    currency: { type: 'string' },
    status: { type: 'string' },
  },
}

const TRANSACTIONS_SOURCE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    externalId: { type: 'string' },
    bankAccountRecordId: { type: 'string' },
    postedAt: { type: 'string' },
    description: { type: 'string' },
    amountMinor: { type: 'number' },
    bankStatus: { type: 'string' },
    matchKey: { type: 'string' },
    source: { type: 'string' },
  },
}
