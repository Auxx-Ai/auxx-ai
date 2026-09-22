// packages/lib/src/accounting/rails/feeds.ts

/**
 * Linking a feed to a rail, and reading whether a rail is ready to post (task 58 §6.2).
 *
 * Replaces `updateGatewaySettlementSettings`/`getGatewaySettlementReadiness` (`settlement.ts`,
 * removed): the rail scope answers "which account" now (§3), so this file has nothing left to
 * validate about accounts - `setRoleAssignment` (`postings/role-map.ts`) already does, on write.
 * What is left is the one column that says which feed a rail reads (`FinancialSourceAccount
 * .paymentGatewayId`, §4.2/§5.5) and whether the rail's own rows are enough to post.
 *
 * No permission checks here. The router asserts `ledgerView`/`ledgerControl`
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { readRoleAssignments } from '../ledger/roles/role-assignments'
import { listOpenDestinationMismatches } from '../money/payouts/reads'
import { wakeReasonCode } from '../work-items/wake'
import { guard } from './guard'
import { getPaymentGateway, listLinkedFeeds } from './reads'

const logger = createScopedLogger('payment-gateways')

/** What `linkFeed` accepts. */
export interface LinkFeedInput {
  organizationId: string
  actorUserId: string
  gatewayId: string
  /** A live `FinancialSourceAccount` of this org - the row `listUnlinkedFeeds` offers. */
  sourceAccountId: string
}

/**
 * Point one feed at one rail (§4.2's one column). Moving a feed already linked elsewhere is
 * allowed - `unlinkFeed` is the explicit "stop reading this feed" door, not a precondition of
 * this one - so a person fixing a wrong link does it in a single click.
 */
export async function linkFeed(
  db: Database,
  input: LinkFeedInput
): Promise<Result<{ sourceAccountId: string; paymentGatewayId: string }, Error>> {
  const { organizationId, gatewayId, sourceAccountId } = input
  return guard(
    async () => {
      const gateway = await getPaymentGateway(db, organizationId, gatewayId)
      if (gateway.isErr()) throw gateway.error
      if (!gateway.value) {
        throw new NotFoundError(`Payment gateway ${gatewayId} was not found`)
      }

      const updated = await db
        .update(schema.FinancialSourceAccount)
        .set({ paymentGatewayId: gatewayId })
        .where(
          and(
            eq(schema.FinancialSourceAccount.id, sourceAccountId),
            eq(schema.FinancialSourceAccount.organizationId, organizationId),
            isNull(schema.FinancialSourceAccount.archivedAt)
          )
        )
        .returning({ id: schema.FinancialSourceAccount.id })
      if (updated.length === 0) {
        throw new NotFoundError(`Feed ${sourceAccountId} was not found`)
      }

      await wakeReasonCode(db, organizationId, 'GATEWAY_UNMAPPED')
      logger.info('Linked a feed to a payment gateway', {
        organizationId,
        gatewayId,
        sourceAccountId,
      })
      return { sourceAccountId, paymentGatewayId: gatewayId }
    },
    'Failed to link a feed to a payment gateway',
    { organizationId, gatewayId, sourceAccountId }
  )
}

/** What `unlinkFeed` accepts. */
export interface UnlinkFeedInput {
  organizationId: string
  actorUserId: string
  sourceAccountId: string
}

/**
 * Clear one feed's rail pointer. The feed row and its history are untouched - only which rail
 * (if any) reads it for new payouts changes.
 */
export async function unlinkFeed(
  db: Database,
  input: UnlinkFeedInput
): Promise<Result<{ sourceAccountId: string }, Error>> {
  const { organizationId, sourceAccountId } = input
  return guard(
    async () => {
      const updated = await db
        .update(schema.FinancialSourceAccount)
        .set({ paymentGatewayId: null })
        .where(
          and(
            eq(schema.FinancialSourceAccount.id, sourceAccountId),
            eq(schema.FinancialSourceAccount.organizationId, organizationId),
            isNull(schema.FinancialSourceAccount.archivedAt)
          )
        )
        .returning({ id: schema.FinancialSourceAccount.id })
      if (updated.length === 0) {
        throw new NotFoundError(`Feed ${sourceAccountId} was not found`)
      }

      logger.info('Unlinked a feed from its payment gateway', { organizationId, sourceAccountId })
      return { sourceAccountId }
    },
    'Failed to unlink a feed from its payment gateway',
    { organizationId, sourceAccountId }
  )
}

/** One feed currently linked to a rail. */
export interface LinkedFeedRow {
  sourceAccountId: string
  providerKey: string
  externalAccountId: string
  name: string | null
}

/** One open `payout_destination_mismatch` on this rail (§5.4 rule 2). */
export interface GatewayMismatch {
  payoutId: string
  number: string | null
  message: string
}

/** Whether a rail can post, and what is still missing. */
export interface GatewayReadiness {
  paymentGatewayId: string
  /** A `clearing` row scoped to this rail exists (any currency). */
  clearingMapped: boolean
  /** A `payment_processing_fees` row scoped to this rail exists - informational, never blocking. */
  feeMapped: boolean
  /** A `bank` row scoped to this rail exists (any currency). */
  bankMapped: boolean
  linkedFeeds: LinkedFeedRow[]
  /**
   * `clearingMapped`, and `bankMapped` whenever a feed is linked (§6.2: "bank row present when a
   * feed is linked" - a manual rail with no feed never raises a payout, so it needs no bank row
   * to be usable for shipments and receipts).
   */
  ready: boolean
  mismatches: GatewayMismatch[]
}

/**
 * Read one rail's mapping completeness (§6.2), for the gateway editor (U8 builds the UI).
 *
 * Presence-only against the role rows - never a full `resolveRoles` type/subtype check, which
 * would duplicate `setRoleAssignment`'s own validation for a screen that only needs to know
 * "is something mapped here at all".
 */
export async function readiness(
  db: Database,
  input: { organizationId: string; gatewayId: string }
): Promise<Result<GatewayReadiness, Error>> {
  const { organizationId, gatewayId } = input
  return guard(
    async () => {
      const gateway = await getPaymentGateway(db, organizationId, gatewayId, {
        includeArchived: true,
      })
      if (gateway.isErr()) throw gateway.error
      if (!gateway.value) {
        throw new NotFoundError(`Payment gateway ${gatewayId} was not found`)
      }

      const assignments = await readRoleAssignments(db, organizationId)
      const mine = assignments.filter(
        (row) => row.paymentGatewayId === gatewayId && !row.markedUnused
      )
      const clearingMapped = mine.some((row) => row.role === ACCOUNT_ROLES.CLEARING)
      const feeMapped = mine.some((row) => row.role === ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)
      const bankMapped = mine.some((row) => row.role === ACCOUNT_ROLES.BANK)

      const feedRows = await listLinkedFeeds(db, organizationId, {
        paymentGatewayIds: [gatewayId],
      })
      const linkedFeeds = feedRows.map((row) => ({
        sourceAccountId: row.id,
        providerKey: row.providerKey,
        externalAccountId: row.externalAccountId,
        name: row.name,
      }))

      const mismatches = await listOpenDestinationMismatches(db, organizationId, gatewayId)

      return {
        paymentGatewayId: gatewayId,
        clearingMapped,
        feeMapped,
        bankMapped,
        linkedFeeds,
        ready: clearingMapped && (linkedFeeds.length === 0 || bankMapped),
        mismatches,
      } satisfies GatewayReadiness
    },
    'Failed to read payment gateway readiness',
    { organizationId, gatewayId }
  )
}
