// packages/lib/src/accounting/connect-and-go/auto-route-rails.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { GlAccountSubtype } from '../../resources/registry/enum-values'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { listChartAccounts, listRoleMap, setRoleAssignment } from '../ledger/roles/role-map'
import {
  buildRailGroups,
  defaultMintFeeAccount,
  findReusableRailAccount,
  isStaleRail,
} from '../rails/rail-groups'
import { listGatewayHandleCensus, listPaymentGateways } from '../rails/reads'
import { setUpPaymentGateway } from '../rails/set-up'
import type { RailRouteReport } from './client'
import { guard } from './guard'

/**
 * Give every unrouted rail whose accounts already exist by name a gateway, and each rail the
 * rail-scoped `bank` when the chart has exactly one bank-subtype account. It never mints an
 * account; anything else comes back as a question. Idempotent: a routed rail is skipped.
 * No permission checks - the router asserts.
 */
export async function autoRouteRails(
  db: Database,
  params: { organizationId: string; actorUserId: string; today?: Date }
): Promise<Result<RailRouteReport, Error>> {
  const { organizationId, actorUserId } = params
  return guard(
    async () => {
      const [census, chart, gateways, roleMap] = await Promise.all([
        listGatewayHandleCensus(db, organizationId),
        listChartAccounts(db, organizationId),
        listPaymentGateways(db, organizationId, { includeArchived: true }),
        listRoleMap(db, organizationId),
      ])
      if (census.isErr()) throw census.error
      if (chart.isErr()) throw chart.error
      if (gateways.isErr()) throw gateways.error
      if (roleMap.isErr()) throw roleMap.error

      const banks = chart.value.filter(
        (row) => row.subtype === GlAccountSubtype.BANK && row.isActive
      )
      const bankAccountId = banks.length === 1 ? (banks[0]?.id ?? null) : null
      const candidateAccountIds = banks.map((row) => row.id)
      const railsWithBank = new Set(
        roleMap.value
          .find((row) => row.role === ACCOUNT_ROLES.BANK)
          ?.railOverrides.map((row) => row.paymentGatewayId) ?? []
      )
      const heldClearing = new Set(gateways.value.map((row) => row.clearingGlAccountId))

      const report: RailRouteReport = {
        created: [],
        banked: [],
        skipped: [],
        questions: [],
        failed: [],
      }

      for (const group of buildRailGroups(census.value)) {
        const handles = group.handles.map((row) => row.handle)

        if (group.state !== 'unrouted') {
          report.skipped.push({
            name: group.name,
            handles,
            reason: group.state,
            gatewayIds: group.claimedBy,
          })
          if (group.state === 'split') {
            report.questions.push({
              kind: 'rail_split',
              name: group.name,
              gatewayIds: group.claimedBy,
              unclaimedHandles: group.handles.filter((row) => !row.claimedBy).map((r) => r.handle),
              mergeInto: group.mergeInto,
            })
          }
          for (const gatewayId of group.claimedBy) {
            if (railsWithBank.has(gatewayId)) continue
            if (!bankAccountId) {
              report.questions.push({
                kind: 'rail_bank',
                gatewayId,
                name: group.name,
                candidateAccountIds,
              })
              continue
            }
            const banked = await setRoleAssignment(db, {
              organizationId,
              role: ACCOUNT_ROLES.BANK,
              paymentGatewayId: gatewayId,
              glAccountId: bankAccountId,
              actorUserId,
            })
            if (banked.isErr()) {
              report.failed.push({ name: group.name, handles, message: banked.error.message })
            } else {
              railsWithBank.add(gatewayId)
              report.banked.push({ gatewayId, bankAccountId })
            }
          }
          continue
        }

        // Never mint: reuse same-name accounts, else ask. The wizard offers create or pick.
        const clearingId = findReusableRailAccount(
          chart.value,
          group.suggestion.clearingAccountName,
          'clearing',
          heldClearing
        )
        const wantsFee = defaultMintFeeAccount(group.suggestion.feeTreatment)
        const feeId = wantsFee
          ? findReusableRailAccount(chart.value, group.suggestion.feeAccountName, 'fee')
          : null
        if (!clearingId || (wantsFee && !feeId)) {
          report.questions.push({ kind: 'rail_accounts', name: group.name, handles })
          continue
        }
        const status = isStaleRail(group.lastSeenAt, params.today) ? 'closed' : 'active'

        const setUp = await setUpPaymentGateway(db, {
          organizationId,
          actorUserId,
          name: group.name,
          handles,
          feeTreatment: group.suggestion.feeTreatment,
          status,
          clearing: { accountId: clearingId },
          fee: feeId ? { accountId: feeId } : null,
          bankAccountId,
        })
        if (setUp.isErr()) {
          report.failed.push({ name: group.name, handles, message: setUp.error.message })
          continue
        }

        const { gateway, failures } = setUp.value
        const bankFailure = failures.find((failure) => failure.step === 'bank')
        report.created.push({
          gatewayId: gateway.id,
          name: gateway.name,
          handles,
          status,
          clearingAccountId: gateway.clearingGlAccountId,
          feeAccountId: gateway.feeGlAccountId,
          bankAccountId: bankAccountId && !bankFailure ? bankAccountId : null,
        })
        if (bankFailure) {
          report.failed.push({ name: group.name, handles, message: bankFailure.message })
        }
        if (!bankAccountId || bankFailure) {
          report.questions.push({
            kind: 'rail_bank',
            gatewayId: gateway.id,
            name: gateway.name,
            candidateAccountIds,
          })
        }
      }

      return report
    },
    'Failed to route payment rails automatically',
    { organizationId }
  )
}
