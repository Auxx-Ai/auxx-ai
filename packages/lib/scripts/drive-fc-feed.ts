// packages/lib/scripts/drive-fc-feed.ts
//
// Drive the Stripe Financial Connections feed end to end against real test-mode data
// (HANDOFF slot 3A). It runs exactly the path the browser flow runs, minus the vendor's
// own authentication modal: read the session's accounts, persist a Credential per
// account, provision the `bank_account` + `DataConnector` + streams + mappings, then run
// one real sync slice through the engine and print what landed.
//
//   npx dotenv -- npx tsx packages/lib/scripts/drive-fc-feed.ts <organizationId> <fca_...>

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { refreshBankAccountCoverage } from '../src/banking/feed/coverage'
import { retrieveAccount, subscribeToTransactions } from '../src/banking/feed/fc-client'
import { financialConnectionsHandler } from '../src/banking/feed/fc-connect'
import { listBankAccounts, readCoverage } from '../src/banking/reads'
import type { HostedProvisionCompleteResult } from '../src/connections/hosted-provision/types'
import { saveConnection } from '../src/connections/save-connection'
import {
  toAccountLabel,
  toBankAccountType,
} from '../src/data-connectors/connectors/stripe-financial-connections'
import { runBackfillSlice, startConnectorSync } from '../src/data-connectors/slice-orchestrator'

const [organizationId, accountId] = process.argv.slice(2)
if (!organizationId || !accountId) {
  throw new Error('usage: drive-fc-feed.ts <organizationId> <fca_...>')
}

async function main() {
  const org = await database.query.Organization.findFirst({
    where: (o, { eq: e }) => e(o.id, organizationId!),
    columns: { id: true, name: true, systemUserId: true },
  })
  if (!org?.systemUserId) throw new Error(`org ${organizationId} not found`)
  const userId = org.systemUserId
  console.log(`org ${org.name} (${org.id})`)

  const connDef = await database.query.ConnectionDefinition.findFirst({
    where: (cd, { eq: e }) => e(cd.providerKey, 'stripeFinancialConnections'),
  })
  if (!connDef) throw new Error('the stripeFinancialConnections definition is not seeded')

  // Read what the bank said. With `FC_SESSION_ID` this is exactly the return route's
  // call; without it the same facts are shaped straight off the account, so the drive
  // does not need a session that has not been consumed.
  let chosen: HostedProvisionCompleteResult | undefined
  if (process.env.FC_SESSION_ID) {
    const results = await financialConnectionsHandler.complete({
      organizationId: org.id,
      userId,
      connectionDefinitionId: connDef.id,
      payload: { sessionId: process.env.FC_SESSION_ID },
    })
    chosen = (Array.isArray(results) ? results : [results]).find(
      (r) => r.providerAccountId === accountId
    )
  } else {
    const account = await retrieveAccount(accountId!)
    const subscribed =
      account.status === 'active' ? await subscribeToTransactions(account.id) : false
    chosen = {
      providerAccountId: account.id,
      label: toAccountLabel(account),
      ready: account.status === 'active' && subscribed,
      connectionVariables: {
        institution: account.institution_name ?? '',
        accountName: account.display_name ?? '',
        last4: account.last4 ?? '',
        accountType: toBankAccountType(account),
        currency: 'USD',
      },
    }
  }
  if (!chosen) throw new Error(`account ${accountId} is not in that session`)
  console.log('complete():', JSON.stringify(chosen, null, 2))

  const saved = await saveConnection({
    connectionDefinitionId: connDef.id,
    providerKey: 'stripeFinancialConnections',
    name: chosen.label,
    organizationId: org.id,
    createdById: userId,
    userId: null,
    connectionData: {
      metadata: {
        providerAccountId: chosen.providerAccountId,
        ready: chosen.ready,
        connectionVariables: chosen.connectionVariables,
      },
    },
  })
  if (saved.isErr()) throw saved.error
  const credentialId = saved.value
  console.log('credential', credentialId)

  await financialConnectionsHandler.onPersisted?.({
    organizationId: org.id,
    userId,
    connectionDefinitionId: connDef.id,
    credentialId,
    result: chosen,
  })

  const connector = await database.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.organizationId, org.id),
      eq(schema.DataConnector.credentialId, credentialId)
    ),
  })
  if (!connector) throw new Error('no connector was provisioned')
  console.log('connector', connector.id, connector.status)

  // One real sync, driven slice by slice the way the worker does.
  await startConnectorSync(database, org.id, connector.id, { trigger: 'manual' })
  const streams = await database.query.DataConnectorStream.findMany({
    where: eq(schema.DataConnectorStream.dataConnectorId, connector.id),
  })
  const run = await database.query.DataConnectorRun.findFirst({
    where: eq(schema.DataConnectorRun.dataConnectorId, connector.id),
    orderBy: (r, { desc }) => desc(r.startedAt),
  })
  for (const stream of streams) {
    for (let slice = 0; slice < 10; slice++) {
      await runBackfillSlice(
        database,
        {
          connectorId: connector.id,
          organizationId: org.id,
          streamId: stream.id,
          runId: run!.id,
        },
        new AbortController().signal
      )
      const fresh = await database.query.DataConnectorStream.findFirst({
        where: eq(schema.DataConnectorStream.id, stream.id),
      })
      const state = fresh?.state as { phase?: string; recordsSeen?: number } | null
      console.log(`slice ${stream.streamKey}#${slice}`, JSON.stringify(state))
      if (state?.phase !== 'backfill') break
    }
  }

  await refreshBankAccountCoverage(database, { organizationId: org.id, connectorId: connector.id })

  const accounts = await listBankAccounts(database, { organizationId: org.id })
  if (accounts.isErr()) throw accounts.error
  const row = accounts.value.find((a) => a.connectorId === connector.id)
  console.log('bank_account', JSON.stringify(row, null, 2))
  if (row) {
    const coverage = await readCoverage(database, {
      organizationId: org.id,
      bankAccountId: row.id,
    })
    console.log(
      'coverage',
      coverage.isOk() ? JSON.stringify(coverage.value, null, 2) : coverage.error
    )
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
