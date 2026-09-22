// packages/lib/scripts/tmp-drive-syncs.ts — temporary driver, not for commit
const [, , action] = process.argv
const ORG = 'abgwpa1l81reht2zmwrcihfu'
const CONNECTOR = 'hpbqldoebnp0fi851rkz5hvg'
async function main() {
  if (action === 'connector') {
    const { enqueueConnectorSync } = await import('../src/data-connectors/data-connector-queue')
    await enqueueConnectorSync({ connectorId: CONNECTOR, organizationId: ORG, trigger: 'manual' })
    console.log('connector sync enqueued')
  } else if (action === 'payouts') {
    const { getQueue } = await import('../src/jobs/queues')
    const { Queues } = await import('../src/jobs/queues/types')
    const queue = getQueue(Queues.maintenanceQueue)
    const job = await queue.add(
      'payoutSyncJob',
      {},
      { jobId: `payoutSyncJob-manual-${Date.now()}`, attempts: 1 }
    )
    console.log('payoutSyncJob enqueued', job.id)
  } else if (action === 'recovery') {
    const { getQueue } = await import('../src/jobs/queues')
    const { Queues } = await import('../src/jobs/queues/types')
    const queue = getQueue(Queues.maintenanceQueue)
    const job = await queue.add(
      'accountingRecoveryJob',
      {},
      { jobId: `accountingRecoveryJob-manual-${Date.now()}`, attempts: 1 }
    )
    console.log('accountingRecoveryJob enqueued', job.id)
  } else if (action === 'rebackfill') {
    const { database } = await import('@auxx/database')
    const { backfillPendingChange } = await import('../src/data-connectors/slice-orchestrator')
    const ok = await backfillPendingChange(database, ORG, CONNECTOR)
    console.log('rebackfill enqueued', ok)
  } else if (action === 'payouts-state') {
    const { getQueue } = await import('../src/jobs/queues')
    const { Queues } = await import('../src/jobs/queues/types')
    const queue = getQueue(Queues.maintenanceQueue)
    const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'completed', 'failed'])
    for (const j of jobs.filter((j) => j.name === 'payoutSyncJob'))
      console.log(
        j.id,
        await j.getState(),
        j.failedReason ?? '',
        JSON.stringify(j.returnvalue ?? null).slice(0, 200)
      )
  }
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
