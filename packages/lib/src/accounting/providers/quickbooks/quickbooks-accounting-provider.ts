// packages/lib/src/accounting/providers/quickbooks/quickbooks-accounting-provider.ts
//
// The QuickBooks `AccountingProvider` adapter: the half of the poster that is
// QuickBooks' and nobody else's.
//
// This class keeps the account map, the chart methods (`resolveAccount`,
// `listProviderAccounts`, `createProviderAccount`, the mapping read/write)
// and the pinned-connection resolver (`contextFor`). The three OBJECT methods
// - `sendObject`, `readObject`, `withdrawObject` - dispatch on `objectType`
// to `money/quickbooks/objects/<object-type>.ts` (plan 67 §5.1): each object
// file owns its own tool ids, its own payload shape and its own layer-2
// duplicate net, over the shared `QuickbooksToolContext` and the helpers in
// `objects/shared.ts`.
//
// Registered from the APP layer via `registerAccountingProvider`, never imported
// by `packages/lib` itself. That direction is decision P1: the ledger is ours
// whether or not anything is connected, so nothing in the posting core may
// depend on a specific accounting integration. See `postings/provider.ts`.
//
// ── Why several layers of idempotency (every object, not only the journal) ──
//
// A double-posted object silently misstates the financial statements, with
// nothing to reconcile it against until a close does not tie out:
//
//   1. PRIMARY (the core's, NOT here). `GlPosting`'s own unique index.
//   2. SECONDARY  a deterministic `DocNumber` + query-before-insert per
//      object type, healing rather than re-posting on a hit. Payment and
//      Deposit carry no `DocNumber` in QuickBooks and so have no layer 2 -
//      see their own object files.
//   3. INNERMOST  `requestid` on the POST itself, from `input.idempotencyKey`
//      - carries NO run salt, and every object file passes it through
//        verbatim rather than deriving its own.
//   4. FORENSIC   the `PrivateNote` stamp, never a lookup key.
//
// And the net under a create failure: `objects/shared.ts`'s `recoverOrClassify`
// re-queries by `DocNumber` before reporting a failure, for every object that
// has one to query by.
//
// `sendObjects` keeps every rung: layer 2 is one batch query, layer 3 is the call's
// `requestid` + each item's `bId` (see `send-objects.ts`), and the net is one batch query.

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../../errors'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { EXPORT_OBJECT_TYPES } from '../../export/payloads'
import { listChartAccounts } from '../../ledger/roles/role-map'
import type { ProviderAccount, ProviderBalanceSheet, WithdrawResult } from '../../ledger/types'
import type { ProviderLedgerSlicer } from '../../mirror/client'
import { readPinnedAccountingConnection } from '../book-connections'
import type {
  AccountingProvider,
  AccountingProviderCapabilities,
  AccountingProviderLimits,
  ClearAccountMappingInput,
  CreateProviderAccountInput,
  CreateProviderAccountResult,
  ProviderObjectContext,
  ReadObjectRef,
  ReadObjectResult,
  SendObjectInput,
  SendObjectResult,
  SetAccountMappingInput,
  WithdrawObjectInput,
} from '../provider'
import {
  clearQuickbooksAccountMapping,
  listQuickbooksProviderAccounts,
  type MappedAccount,
  readQuickbooksAccountMap,
  setQuickbooksAccountMapping,
  toProviderAccount,
} from './account-map'
import { quickbooksAccountType } from './account-types'
import { type QuickbooksToolContext, resolveQuickbooksContext } from './invoke-quickbooks-tool'
import { QUICKBOOKS_LEDGER_SLICER } from './ledger-slicer'
import * as billObject from './objects/bill'
import * as creditMemoObject from './objects/credit-memo'
import * as depositObject from './objects/deposit'
import * as invoiceObject from './objects/invoice'
import * as journalObject from './objects/journal'
import * as paymentObject from './objects/payment'
import * as refundReceiptObject from './objects/refund-receipt'
import * as salesReceiptObject from './objects/sales-receipt'
import { errorMessage, norm, QUICKBOOKS_PROVIDER_ID, resolveMappedAccounts } from './objects/shared'
import * as vendorCreditObject from './objects/vendor-credit'
import { type QuickbooksBatchObject, sendQuickbooksObjects } from './send-objects'

const logger = createScopedLogger('quickbooks-accounting-provider')

export { QUICKBOOKS_PROVIDER_ID }

/** Brief 19 section 3: the opening-balance suggestion's one report read. */
const TOOL_GET_BALANCE_SHEET = 'get_quickbooks_balance_sheet'
/** The one call that runs the seam BACKWARDS - see `createProviderAccount`. */
const TOOL_CREATE_ACCOUNT = 'create_quickbooks_account'

/** One native object's `send`/`read`/`withdraw`, in the seam's own shapes. */
interface QuickbooksObjectHandler {
  send(
    tool: QuickbooksToolContext,
    ctx: ProviderObjectContext,
    input: SendObjectInput
  ): Promise<Result<SendObjectResult, Error>>
  read(tool: QuickbooksToolContext, ref: ReadObjectRef): Promise<Result<ReadObjectResult, Error>>
  withdraw(
    tool: QuickbooksToolContext,
    input: WithdrawObjectInput
  ): Promise<Result<WithdrawResult, Error>>
}

/** Every native object type this adapter can send, read and withdraw (plan 67 §1's table). */
const OBJECT_HANDLERS: Record<string, QuickbooksObjectHandler> = {
  journal: journalObject,
  sales_receipt: salesReceiptObject,
  invoice: invoiceObject,
  payment: paymentObject,
  credit_memo: creditMemoObject,
  refund_receipt: refundReceiptObject,
  deposit: depositObject,
  bill: billObject,
  vendor_credit: vendorCreditObject,
}

/** The object types `batch_quickbooks_operations` creates; `vendor_credit` is not one, so it sends alone. */
const BATCH_OBJECTS: Record<string, QuickbooksBatchObject> = {
  journal: journalObject.batchObject as QuickbooksBatchObject,
  sales_receipt: salesReceiptObject.batchObject as QuickbooksBatchObject,
  invoice: invoiceObject.batchObject as QuickbooksBatchObject,
  payment: paymentObject.batchObject as QuickbooksBatchObject,
  credit_memo: creditMemoObject.batchObject as QuickbooksBatchObject,
  refund_receipt: refundReceiptObject.batchObject as QuickbooksBatchObject,
  deposit: depositObject.batchObject as QuickbooksBatchObject,
  bill: billObject.batchObject as QuickbooksBatchObject,
}

/** The deep-link path per object type (plan 67 §5.6). All take `?txnId=`. */
const OBJECT_URL_PATH: Record<string, string> = {
  journal: '/app/journal',
  sales_receipt: '/app/salesreceipt',
  invoice: '/app/invoice',
  payment: '/app/recvpayment',
  credit_memo: '/app/creditmemo',
  refund_receipt: '/app/refundreceipt',
  deposit: '/app/deposit',
  bill: '/app/bill',
  vendor_credit: '/app/vendorcredit',
}

// A cheap exactness check the moment this module loads: every object type the
// payload layer knows about must have a handler, and vice versa, or a new
// object type silently falls through `sendObject` as "unrecognised".
for (const objectType of EXPORT_OBJECT_TYPES) {
  if (!OBJECT_HANDLERS[objectType]) {
    throw new Error(`QuickBooks adapter has no object handler for '${objectType}'`)
  }
}

/**
 * QuickBooks as an accounting provider.
 *
 * Stateless: `orgId` arrives on every call and everything per-org (the
 * installation, the connection, the chart) is resolved inside the call, where it
 * can also be refreshed. That is what lets `postings/provider.ts` cache one
 * instance per provider id rather than one per organization.
 */
export class QuickbooksAccountingProvider implements AccountingProvider {
  readonly id = QUICKBOOKS_PROVIDER_ID
  // The caps the app's tool schemas enforce (`.max(...)` in `create-quickbooks-*.tool.tsx`).
  readonly limits: AccountingProviderLimits = {
    idempotencyKeyLength: 50,
    docNumberLength: 21,
    noteLength: 4000,
    pageSize: 1000,
    // Intuit's published throttle per realm.
    rateLimit: { perMinute: 500, concurrent: 10 },
  }
  readonly capabilities: AccountingProviderCapabilities = {
    objects: {
      // No `get_quickbooks_journal_entry`: a journal is found by its DocNumber and reports no total.
      journal: { readsBack: 'docNumber' },
      sales_receipt: { readsBack: 'object' },
      invoice: { readsBack: 'object' },
      payment: { readsBack: 'object' },
      credit_memo: { readsBack: 'object' },
      refund_receipt: { readsBack: 'object' },
      deposit: { readsBack: 'object' },
      bill: { readsBack: 'object' },
    },
    withdrawRequiresVersion: true,
    withdrawIs: 'delete',
    canCreateAccounts: true,
    objectUrls: true,
  }

  /**
   * Resolve one auxx account CODE to its QuickBooks account id.
   *
   * 🛑 This is the ONLY place a code becomes a provider identifier (decision
   * P2). The code is translated to the account's `glAccountId` here, then
   * handed to {@link resolveMappedAccounts} - the same by-id door every
   * object's `send` uses, so no two paths can disagree about what one
   * account resolves to.
   */
  async resolveAccount(orgId: string, code: string): Promise<Result<string, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          `QuickBooks is not connected, so account code '${code}' cannot be resolved`,
          { accountCode: code }
        )
      )
    }

    const notResolved = () =>
      err(
        new UnprocessableEntityError(
          `Account code '${code}' could not be resolved to a QuickBooks account.`,
          { accountCode: code }
        )
      )

    try {
      const ourChart = await listChartAccounts(database, orgId)
      if (ourChart.isErr()) return err(ourChart.error)
      const ourAccount = ourChart.value.find((row) => norm(row.code) === norm(code))
      if (!ourAccount) return notResolved()

      const accounts = await resolveMappedAccounts(resolved.context, [ourAccount.id])
      if (accounts.isErr()) return err(accounts.error)
      const account = accounts.value.accounts.get(ourAccount.id)
      return account ? ok(account.id) : notResolved()
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks chart of accounts to resolve '${code}': ${errorMessage(error)}`,
          { accountCode: code }
        )
      )
    }
  }

  /**
   * The connected company's chart, for the `G19` mapping screen.
   *
   * Inactive accounts INCLUDED - see the interface. This is the only chart read
   * in this file that keeps them, and the difference is deliberate: a screen has
   * to be able to say "the account you mapped has been deactivated", which it
   * cannot do about a row it never received.
   */
  async listProviderAccounts(orgId: string): Promise<Result<ProviderAccount[], Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) return ok([])

    try {
      return ok(await listQuickbooksProviderAccounts(resolved.context))
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks chart of accounts: ${errorMessage(error)}`
        )
      )
    }
  }

  /**
   * The connected company's balance sheet as of `asOf` - any date, not just a
   * cutover. The opening-balance fill (brief 19) is one caller; the agreement
   * view (brief 20 §8) is another, asking as of a period end or an arbitrary
   * date a person picked.
   */
  async readProviderBalances(
    orgId: string,
    asOf: string
  ): Promise<Result<ProviderBalanceSheet | null, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) return ok(null)

    try {
      return ok(
        (await resolved.context.callTool(TOOL_GET_BALANCE_SHEET, {
          asOf,
          accountingMethod: 'Accrual',
        })) as ProviderBalanceSheet
      )
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks balance sheet: ${errorMessage(error)}`
        )
      )
    }
  }

  /**
   * How the connected company's general ledger is walked - the INBOUND half of
   * the seam (brief 20 §5.1), and the only way the accountant's own entries ever
   * reach auxx.
   */
  ledgerSlicer(): ProviderLedgerSlicer {
    return QUICKBOOKS_LEDGER_SLICER
  }

  /** The org's confirmed `gl_account -> QuickBooks account` map. */
  async listAccountMappings(orgId: string): Promise<Result<Map<string, string>, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: orgId })
    if (!resolved.connected) return ok(new Map())

    try {
      return ok(
        await readQuickbooksAccountMap({
          organizationId: orgId,
          installationId: resolved.context.installationId,
          connectionId: resolved.context.connectionId,
        })
      )
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not read the QuickBooks account map: ${errorMessage(error)}`
        )
      )
    }
  }

  /**
   * Record one human confirmation.
   *
   * The pairing has already been validated by `postings/account-identities.ts`
   * against the live chart. This writes it and does not re-decide it.
   */
  async setAccountMapping(input: SetAccountMappingInput): Promise<Result<void, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: input.orgId })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          'QuickBooks is not connected, so an account mapping cannot be saved.',
          { organizationId: input.orgId }
        )
      )
    }

    try {
      await setQuickbooksAccountMapping({
        organizationId: input.orgId,
        installationId: resolved.context.installationId,
        connectionId: resolved.context.connectionId,
        glAccountId: input.glAccountId,
        providerAccountId: input.providerAccountId,
        userId: input.actorUserId,
      })
      return ok(undefined)
    } catch (error) {
      return err(
        new UnprocessableEntityError(`Could not save the account mapping: ${errorMessage(error)}`, {
          organizationId: input.orgId,
          glAccountId: input.glAccountId,
        })
      )
    }
  }

  /** Withdraw one confirmation. The account goes back to unmapped. */
  async clearAccountMapping(input: ClearAccountMappingInput): Promise<Result<void, Error>> {
    const resolved = await resolveQuickbooksContext({ organizationId: input.orgId })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          'QuickBooks is not connected, so there is no account mapping to clear.',
          { organizationId: input.orgId }
        )
      )
    }

    try {
      await clearQuickbooksAccountMapping({
        organizationId: input.orgId,
        installationId: resolved.context.installationId,
        connectionId: resolved.context.connectionId,
        glAccountId: input.glAccountId,
        userId: input.actorUserId,
      })
      return ok(undefined)
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not clear the account mapping: ${errorMessage(error)}`,
          {
            organizationId: input.orgId,
            glAccountId: input.glAccountId,
          }
        )
      )
    }
  }

  /**
   * Create one object from a frozen, provider-neutral payload.
   *
   * Dispatches on `objectType` to `objects/<object-type>.ts` (plan 67 §5.1);
   * the org's `quickbooks.postJournalEntries` switch and the resolved tool
   * context are common to every object type and checked here, once, before
   * the dispatch.
   */
  async sendObject(
    ctx: ProviderObjectContext,
    input: SendObjectInput
  ): Promise<Result<SendObjectResult, Error>> {
    const handler = OBJECT_HANDLERS[input.objectType]
    if (!handler) {
      return err(
        new UnprocessableEntityError(`auxx cannot create a QuickBooks '${input.objectType}'.`, {
          organizationId: ctx.organizationId,
          objectType: input.objectType,
        })
      )
    }

    const organizationId = ctx.organizationId
    try {
      // The org's own switch. Renaming it to an export-wide switch is a
      // follow-up (plan 67 §5.5); today it gates every object type, not only
      // the journal.
      const enabled = await getOrganizationSetting({
        organizationId,
        key: 'quickbooks.postJournalEntries',
      })
      if (!enabled) {
        logger.debug('QuickBooks export is switched off - staying internal', {
          organizationId,
          objectType: input.objectType,
        })
        return ok({
          status: 'disabled',
          externalId: '',
          remoteVersion: null,
          providerId: QUICKBOOKS_PROVIDER_ID,
        })
      }

      const tool = await this.contextFor(ctx)
      if (!tool)
        return ok({
          status: 'not_connected',
          externalId: '',
          remoteVersion: null,
          providerId: QUICKBOOKS_PROVIDER_ID,
        })

      return await handler.send(tool, ctx, input)
    } catch (error) {
      return err(
        new UnprocessableEntityError(errorMessage(error), {
          organizationId,
          objectType: input.objectType,
        })
      )
    }
  }

  /**
   * Create many objects over one pinned context: one batch query for their
   * DocNumbers, one batch create for the misses (plan 93 D3). The switch and the
   * connection are checked once for the whole call, as `sendObject` checks them per object.
   */
  async sendObjects(
    ctx: ProviderObjectContext,
    inputs: SendObjectInput[]
  ): Promise<Result<Result<SendObjectResult, Error>[], Error>> {
    const organizationId = ctx.organizationId
    const unsent = (status: 'disabled' | 'not_connected') =>
      ok(
        inputs.map(() =>
          ok<SendObjectResult, Error>({
            status,
            externalId: '',
            remoteVersion: null,
            providerId: QUICKBOOKS_PROVIDER_ID,
          })
        )
      )
    try {
      const enabled = await getOrganizationSetting({
        organizationId,
        key: 'quickbooks.postJournalEntries',
      })
      if (!enabled) return unsent('disabled')

      const tool = await this.contextFor(ctx)
      if (!tool) return unsent('not_connected')

      return ok(
        await sendQuickbooksObjects(tool, ctx, inputs, BATCH_OBJECTS, async (shared, input) => {
          const handler = OBJECT_HANDLERS[input.objectType]
          if (!handler)
            return err(
              new UnprocessableEntityError(
                `auxx cannot create a QuickBooks '${input.objectType}'.`,
                {
                  organizationId,
                  objectType: input.objectType,
                }
              )
            )
          try {
            return await handler.send(shared, ctx, input)
          } catch (error) {
            return err(
              new UnprocessableEntityError(errorMessage(error), {
                organizationId,
                objectType: input.objectType,
              })
            )
          }
        })
      )
    } catch (error) {
      return err(new UnprocessableEntityError(errorMessage(error), { organizationId }))
    }
  }

  /** Read one object back. Dispatches on `objectType`; see each object file's own `read`. */
  async readObject(
    ctx: ProviderObjectContext,
    ref: ReadObjectRef
  ): Promise<Result<ReadObjectResult, Error>> {
    const absent: ReadObjectResult = {
      status: 'unsupported',
      externalId: ref.externalId,
      remoteVersion: null,
      docNumber: ref.docNumber,
      totalMinor: null,
      payloadHash: null,
    }
    const handler = OBJECT_HANDLERS[ref.objectType]
    if (!handler) return ok(absent)

    const tool = await this.contextFor(ctx)
    if (!tool) return ok(absent)

    return handler.read(tool, ref)
  }

  /**
   * Remove one object we created, by the id recorded when we created it.
   *
   * Converges: an object QuickBooks no longer holds answers `already_gone`
   * rather than failing (brief 60 §5.1 step 4). `remoteVersion` is REQUIRED -
   * Intuit refuses a delete carrying a stale one, and re-reading a fresh
   * token here would discard an accountant's edit instead of reporting it.
   *
   * 🛑 Unlike `sendObject`/`readObject`, this resolves the connection LIVE
   * rather than through the pinned one - unchanged from before this brief.
   */
  async withdrawObject(
    ctx: ProviderObjectContext,
    input: WithdrawObjectInput
  ): Promise<Result<WithdrawResult, Error>> {
    const context = { organizationId: ctx.organizationId, externalId: input.externalId }

    const handler = OBJECT_HANDLERS[input.objectType]
    if (!handler) {
      return err(
        new UnprocessableEntityError(`auxx cannot remove a QuickBooks '${input.objectType}'.`, {
          ...context,
          objectType: input.objectType,
        })
      )
    }
    if (!input.externalId) {
      return err(
        new UnprocessableEntityError(
          'We have no record of what was created in QuickBooks, so nothing can be removed safely.',
          context
        )
      )
    }
    if (!input.remoteVersion) {
      return err(
        new UnprocessableEntityError(
          `We have no recorded version for QuickBooks ${input.objectType} ${input.externalId}, and QuickBooks refuses a delete without one.`,
          context
        )
      )
    }

    const resolved = await resolveQuickbooksContext({ organizationId: ctx.organizationId })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          'QuickBooks is not connected, so there is nothing to remove from it.',
          context
        )
      )
    }

    return handler.withdraw(resolved.context, input)
  }

  /**
   * The deep link into this object's own QuickBooks register (plan 67 §5.6).
   * `null` for an object type this map does not know - which today is never,
   * since every `EXPORT_OBJECT_TYPES` member has a path above.
   */
  objectUrl(ref: { objectType: string; externalId: string }): string | null {
    const path = OBJECT_URL_PATH[ref.objectType]
    if (!path) return null
    return `https://app.qbo.intuit.com${path}?txnId=${encodeURIComponent(ref.externalId)}`
  }

  /**
   * Create the QuickBooks counterpart of one of our accounts.
   *
   * The only method here that WRITES to QuickBooks outside an object create,
   * and the reason it exists is §8.5 of the 2026-09-10 handoff: the accounts
   * auxx creates itself have no counterpart to match, so no suggestion is
   * ever produced for them and the export refuses on every one.
   *
   * 🛑 The mapping is NOT written here - see the interface's own docblock.
   */
  async createProviderAccount(
    input: CreateProviderAccountInput
  ): Promise<Result<CreateProviderAccountResult, Error>> {
    const resolved = await resolveQuickbooksContext({
      organizationId: input.orgId,
      actorUserId: input.actorUserId,
    })
    if (!resolved.connected) {
      return err(
        new UnprocessableEntityError(
          'QuickBooks is not connected, so an account cannot be created in it.',
          { organizationId: input.orgId, glAccountId: input.glAccountId }
        )
      )
    }

    const { accountType, accountSubType } = quickbooksAccountType(
      input.classification,
      input.subtype
    )

    try {
      const result = (await resolved.context.callTool(TOOL_CREATE_ACCOUNT, {
        name: input.name,
        ...(input.code ? { acctNum: input.code } : {}),
        accountType,
        accountSubType,
        // TODO(accounting): the tool does not declare `parentId` yet - sent only
        // when the caller resolved one, so an org with no nested accounts never
        // exercises an argument the schema may not accept.
        ...(input.parentProviderId ? { parentId: input.parentProviderId } : {}),
      })) as {
        account: MappedAccount
        outcome: 'created' | 'existing'
        acctNumDropped: boolean
      }

      const account = toProviderAccount(result.account)
      if (!account) {
        return err(
          new UnprocessableEntityError(
            `QuickBooks returned account '${result.account.fullyQualifiedName}' with an unreadable classification '${result.account.classification}'. Link it by hand.`,
            { organizationId: input.orgId, glAccountId: input.glAccountId }
          )
        )
      }

      return ok({
        account,
        outcome: result.outcome,
        numberDropped: Boolean(result.acctNumDropped),
      })
    } catch (error) {
      return err(
        new UnprocessableEntityError(
          `Could not create '${input.name}' in QuickBooks: ${errorMessage(error)}`,
          { organizationId: input.orgId, glAccountId: input.glAccountId, accountType }
        )
      )
    }
  }

  /**
   * The tool context for the connection a batch is PINNED to, not for whatever
   * is connected now: a cutover mid-export must not silently redirect an
   * object into another company's books.
   */
  private async contextFor(ctx: ProviderObjectContext): Promise<QuickbooksToolContext | null> {
    const pinned = await readPinnedAccountingConnection(
      database,
      ctx.organizationId,
      ctx.connectionId
    )
    const resolved = await resolveQuickbooksContext({
      organizationId: ctx.organizationId,
      pinnedCredentialId: pinned.credentialId,
      expectedCompanyId: pinned.companyId,
      ...(ctx.actorUserId ? { actorUserId: ctx.actorUserId } : {}),
    })
    if (!resolved.connected) return null
    if (resolved.context.installationId !== pinned.appInstallationId)
      throw new UnprocessableEntityError('The pinned accounting installation changed')
    return resolved.context
  }
}

/**
 * Factory for `registerAccountingProvider`.
 *
 * 🛑 Called from the APP layer, never from `packages/lib`. Registering at module
 * scope here would put an import edge from the posting core to a specific
 * accounting integration, which is the exact dependency decision P1 forbids.
 */
export function createQuickbooksAccountingProvider(): AccountingProvider {
  return new QuickbooksAccountingProvider()
}
