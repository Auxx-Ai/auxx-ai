// packages/lib/src/data-connectors/run-control.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'

/** Request a stop while leaving active slices time to save their checkpoints. */
export async function requestConnectorPause(
  tx: Transaction,
  organizationId: string,
  connectorId: string
): Promise<void> {
  const T = schema.DataConnectorRun
  await tx
    .update(T)
    .set({
      progress: sql`jsonb_set(coalesce(${T.progress}, '{}'::jsonb), '{paused}', '{"reason":"manual"}'::jsonb)`,
    })
    .where(
      and(
        eq(T.organizationId, organizationId),
        eq(T.dataConnectorId, connectorId),
        eq(T.status, 'running')
      )
    )
}

/** True only for a durable manual stop request; completed runs are handled separately. */
export async function isRunPauseRequested(db: Database, runId: string): Promise<boolean> {
  const row = await db.query.DataConnectorRun.findFirst({
    where: eq(schema.DataConnectorRun.id, runId),
    columns: { progress: true },
  })
  return (row?.progress as { paused?: { reason?: string } } | null)?.paused?.reason === 'manual'
}

/** Mark each stream stopped once, without letting an old run decrement a new run's latch. */
export async function completeRunStream(
  db: Database,
  connectorId: string,
  input: {
    runId: string
    streamId: string
  }
): Promise<number | null> {
  return db.transaction(async (tx) => {
    // Connector edits lock the connector before updating runs; use the same order.
    await tx
      .select({ id: schema.DataConnector.id })
      .from(schema.DataConnector)
      .where(eq(schema.DataConnector.id, connectorId))
      .for('update')
    const [run] = await tx
      .select()
      .from(schema.DataConnectorRun)
      .where(
        and(
          eq(schema.DataConnectorRun.id, input.runId),
          eq(schema.DataConnectorRun.dataConnectorId, connectorId)
        )
      )
      .for('update')
    if (!run || run.status !== 'running') return null
    const streams =
      (run.chainSnapshot as { streams?: { streamId: string }[] } | null)?.streams ?? []
    if (!streams.some((s) => s.streamId === input.streamId)) return null
    const progress = (run.progress ?? {}) as Record<string, unknown> & {
      finishedStreams?: string[]
      finalizingStreamId?: string
    }
    const finished = new Set(progress.finishedStreams ?? [])
    finished.add(input.streamId)
    const remaining = streams.filter((s) => !finished.has(s.streamId)).length
    const finalizingStreamId =
      progress.finalizingStreamId ?? (remaining === 0 ? input.streamId : undefined)
    await tx
      .update(schema.DataConnectorRun)
      .set({
        progress: {
          ...progress,
          finishedStreams: [...finished],
          ...(finalizingStreamId ? { finalizingStreamId } : {}),
        },
        heartbeatAt: new Date(),
      })
      .where(eq(schema.DataConnectorRun.id, input.runId))
    const C = schema.DataConnector
    await tx
      .update(C)
      .set({
        state: sql`jsonb_set(coalesce(${C.state}, '{}'::jsonb), '{backfillStreamsRemaining}', to_jsonb(${remaining}::int))`,
      })
      .where(eq(C.id, connectorId))
    // Only the final stream may retry finalization; a replay of an earlier stream
    // cannot publish the manifest concurrently with the final stream.
    return remaining === 0 && finalizingStreamId !== input.streamId ? null : remaining
  })
}
