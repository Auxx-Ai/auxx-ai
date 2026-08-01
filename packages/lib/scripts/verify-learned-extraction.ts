// packages/lib/scripts/verify-learned-extraction.ts
//
// One-off live verify for the AI Memory production-readiness fixes
// (plans/ai-memory/ai-memory-production-readiness-plan.md). Drives the real
// dev DB and a real LLM call:
//   1. runs the extraction job against an UNASSIGNED archived thread — the
//      case that silently no-op'd before the principal resolver
//   2. reports the principal it resolved, the outcome, and the bundle
//   3. checks the thread stamp and the AiUsage row the run should have billed
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/verify-learned-extraction.ts <threadId>

import { database as db, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { learnedExtractionJob } from '../src/jobs/approvals/learned-extraction-job'
import { resolveLearnedRunPrincipal } from '../src/jobs/approvals/learned-run-principal'

async function main() {
  const threadId = process.argv[2]
  // Optional: `--force <requestedByUserId>` drives the "Remember this thread"
  // path, which must bind to the requester and own the bundle for them.
  const force = process.argv.includes('--force')
  const requestedByUserId = force ? process.argv[process.argv.indexOf('--force') + 1] : undefined
  if (!threadId)
    throw new Error('usage: verify-learned-extraction.ts <threadId> [--force <userId>]')

  const thread = await db.query.Thread.findFirst({
    where: eq(schema.Thread.id, threadId),
  })
  if (!thread) throw new Error(`Thread ${threadId} not found`)
  const organizationId = thread.organizationId

  console.log('--- thread ---')
  console.log({
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    assigneeId: thread.assigneeId,
    messageCount: thread.messageCount,
    learnedExtractedAt: thread.learnedExtractedAt,
  })

  const principal = await resolveLearnedRunPrincipal({
    db,
    organizationId,
    threadId,
    assigneeId: thread.assigneeId,
    requestedByUserId,
  })
  console.log('--- resolved principal ---')
  console.log(principal)

  const data = { organizationId, threadId, force, requestedByUserId }
  const result = await learnedExtractionJob({
    job: { data },
    data,
    jobId: 'verify-learned-extraction',
    jobName: 'learnedExtractionJob',
  } as never)
  console.log('--- job result ---')
  console.log(result)

  const after = await db.query.Thread.findFirst({
    where: eq(schema.Thread.id, threadId),
    columns: { learnedExtractedAt: true },
  })
  console.log('--- stamp after ---', after?.learnedExtractedAt)

  const bundles = await db
    .select({
      id: schema.AiSuggestion.id,
      status: schema.AiSuggestion.status,
      ownerUserId: schema.AiSuggestion.ownerUserId,
      actionCount: schema.AiSuggestion.actionCount,
      bundle: schema.AiSuggestion.bundle,
    })
    .from(schema.AiSuggestion)
    .where(
      and(
        eq(schema.AiSuggestion.threadId, threadId),
        eq(schema.AiSuggestion.triggerSource, 'learned-extraction')
      )
    )
  console.log('--- bundles ---')
  console.log(JSON.stringify(bundles, null, 2))

  const usage = await db
    .select({
      source: schema.AiUsage.source,
      sourceId: schema.AiUsage.sourceId,
      model: schema.AiUsage.model,
      totalTokens: schema.AiUsage.totalTokens,
      creditsUsed: schema.AiUsage.creditsUsed,
      providerType: schema.AiUsage.providerType,
      createdAt: schema.AiUsage.createdAt,
    })
    .from(schema.AiUsage)
    .where(eq(schema.AiUsage.sourceId, threadId))
    .orderBy(desc(schema.AiUsage.createdAt))
    .limit(10)
  console.log('--- usage rows for this thread ---')
  console.log(usage)

  process.exit(0)
}

main().catch((err) => {
  console.error('verify failed:', err)
  process.exit(1)
})
