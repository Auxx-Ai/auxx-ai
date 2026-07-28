// apps/web/src/app/api/eval/run/[runId]/events/route.ts
//
// SSE recovery endpoint for an eval run. Authorizes the run by organization,
// replays persisted status + trace after the requested sequence, then subscribes
// to live Redis events on `eval:run:<runId>`. Reconnecting after the worker
// finishes still returns the full trace + verdict from the durable row. Redis is
// transport, not storage. See conventions.md §8.

import { database as db, schema } from '@auxx/database'
import { getCapabilities } from '@auxx/lib/permissions'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { createScopedLogger } from '@auxx/logger'
import { RedisEventRouter } from '@auxx/redis'
import type { AssertionResult, EvalTraceEvent } from '@auxx/types/evals'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('eval-run-events-api')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EvalRunEvent =
  | { type: 'trace'; event: EvalTraceEvent }
  | { type: 'status'; status: string; assertionResults?: AssertionResult[] }
  | { type: 'done' }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { runId } = await params
  const organizationId =
    (session.user as { defaultOrganizationId?: string; organizationId?: string })
      .defaultOrganizationId ?? (session.user as { organizationId?: string }).organizationId
  if (!organizationId) return new Response('No organization', { status: 403 })

  // Same class of gap as the Kopilot stream route: this handler authenticated
  // with `getSession` and scoped by org, but read no capabilities — so any
  // authenticated member could replay an eval run's full trace (agent messages,
  // tool calls, assertion verdicts) while every `eval.*` tRPC procedure sits
  // behind `permissionProcedure(agentsManage)`.
  //
  // Capability only, deliberately: `evalManageProcedure` also plan-ANDs
  // `agentProcedures`, but this is a read-only RECONNECT stream for a run that
  // was already started behind that gate, and failing a live reconnect on a
  // mid-run plan change would be worse than the gap it closes.
  const capabilities = await getCapabilities(session.user.id, organizationId)
  if (!capabilities.can(PermissionKey.agentsManage)) {
    return new Response('Forbidden', { status: 403 })
  }

  const [run] = await db
    .select()
    .from(schema.EvalRun)
    .where(and(eq(schema.EvalRun.id, runId), eq(schema.EvalRun.organizationId, organizationId)))
    .limit(1)
  if (!run) return new Response('Eval run not found', { status: 404 })

  // Resume point: `Last-Event-ID` (our trace sequence) or `?afterSequence=`.
  const lastEventId = request.headers.get('last-event-id')
  const afterParam = request.nextUrl.searchParams.get('afterSequence')
  const afterSequence = Number.parseInt(lastEventId ?? afterParam ?? '-1', 10)
  const since = Number.isNaN(afterSequence) ? -1 : afterSequence

  const isTerminal = !['queued', 'running'].includes(run.status)
  const encoder = new TextEncoder()

  // Hoisted so the stream's cancel() handler can tear down the subscription on disconnect.
  let cleanup: () => Promise<void> = async () => {}

  const stream = new ReadableStream({
    async start(controller) {
      // Once the stream is closed (disconnect, error, completion) we must stop touching the
      // controller. Without this guard, a flood of trace events each hits a closed controller
      // and spams error logs (and leaks the Redis subscription).
      let closed = false

      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return

        const lines = [`event: ${event}`]
        if (id !== undefined) lines.push(`id: ${id}`)
        lines.push(`data: ${JSON.stringify(data)}`, '', '')
        try {
          controller.enqueue(encoder.encode(lines.join('\n')))
        } catch {
          // Controller closed underneath us (client gone). Tear down once instead of
          // logging an error for every subsequent event.
          void cleanup()
        }
      }

      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat)
          return
        }
        try {
          controller.enqueue(encoder.encode(':heartbeat\n\n'))
        } catch {
          void cleanup()
        }
      }, 15000)

      let handlerId: string | null = null
      let router: RedisEventRouter | null = null
      cleanup = async () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        if (router && handlerId) {
          try {
            await router.unsubscribe(handlerId)
          } catch (error) {
            logger.error('Eval SSE cleanup error', { error, runId })
          }
        }
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      // Highest trace sequence already emitted — dedupes a persisted/live overlap.
      let maxSent = since

      try {
        send('connected', { runId, status: run.status, timestamp: new Date().toISOString() })

        // Replay persisted trace after the requested sequence.
        const persisted = (run.trace ?? []) as EvalTraceEvent[]
        for (const event of persisted) {
          if (event.sequence > since) {
            send('trace', { type: 'trace', event }, event.sequence)
            if (event.sequence > maxSent) maxSent = event.sequence
          }
        }

        // Already terminal → emit authoritative verdict and close.
        if (isTerminal) {
          send('status', {
            type: 'status',
            status: run.status,
            assertionResults: (run.assertionResults ?? []) as AssertionResult[],
          })
          send('done', { type: 'done' })
          await cleanup()
          return
        }

        // Subscribe to live events; dedupe trace by sequence.
        router = RedisEventRouter.getInstance('eval-events')
        handlerId = await router.subscribe({
          pattern: `eval:run:${runId}`,
          handler: (raw: unknown) => {
            const event = raw as EvalRunEvent
            if (event.type === 'trace') {
              if (event.event.sequence > maxSent) {
                maxSent = event.event.sequence
                send('trace', event, event.event.sequence)
              }
            } else if (event.type === 'status') {
              send('status', event)
            } else if (event.type === 'done') {
              send('done', event)
              void cleanup()
            }
          },
          metadata: { type: 'eval-sse', runId },
        })

        request.signal.addEventListener('abort', cleanup)
        logger.info('Eval SSE connection established', { runId, organizationId })
      } catch (error) {
        logger.error('Eval SSE stream error', { error, runId })
        await cleanup()
      }
    },
    // Fires when the consumer cancels the stream (client disconnect). More reliable than
    // request.signal in some runtimes, and ensures the subscription is removed so events stop.
    async cancel() {
      await cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
