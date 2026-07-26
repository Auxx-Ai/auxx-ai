// packages/lib/src/approvals/learned-extraction-runner.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { AgentEngine } from '../ai/agent-framework/engine'
import type {
  AgentDefinition,
  AgentDomainConfig,
  AgentEngineConfig,
  AgentState,
  AgentToolDefinition,
} from '../ai/agent-framework/types'
import { sessionMessagesToWire } from '../ai/agent-framework/utils'
import type { Message } from '../ai/clients/base/types'
import {
  createCapabilityRegistry,
  createKbReadCapabilities,
  createKnowledgeCapabilities,
  createLearnedKbCapabilities,
  type GetToolDeps,
} from '../ai/kopilot/capabilities'
import { getCachedKbCatalog } from '../cache/org-cache-helpers'
import { renderKbCatalog } from '../kb/catalog/render-kb-catalog'
import { Result, type TypedResult } from '../result'
import { stripHtml } from '../tiptap'
import { type HeadlessRunDeps, resolveCaptureRunPrincipal } from './headless-runner'
import type { HeadlessRunResult } from './types'
import { mergeActions, parseFinalText } from './utils'

const logger = createScopedLogger('learned-extraction-runner')

/** Most recent messages included verbatim in the transcript. */
const TRANSCRIPT_MESSAGE_CAP = 30
/** Per-message body cap in the transcript. */
const MESSAGE_BODY_CAP = 2_000

const EXTRACTION_SYSTEM_PROMPT = `You are updating the organization's learned knowledge base ("AI Memory") from a resolved conversation. Extract only durable, reusable knowledge: policies, product facts, how the human chose to answer, and stable customer facts. Skip one-off details (order numbers, dates, apologies, scheduling back-and-forth).

Rules:
- Check the AI Memory catalog first. If an existing article covers the topic, read it with get_article and UPDATE it via upsert_learned_article, passing the merged FULL markdown — preserve existing content, especially anything a human wrote or edited. Never create a second article for a topic that already has one.
- Only create a new article when no existing article fits; keep one living article per topic.
- Facts about a specific contact or company belong in the 'contacts'/'companies' category as that record's single article — pass the recordId. Topical organizational knowledge goes in 'policies'.
- Most conversations teach nothing durable. When in doubt, save nothing — a noisy memory is worse than a small one. Limit yourself to 5 read-tool calls.
- Proposed writes are queued for human approval, not executed immediately; you will see a predicted output (e.g. a temp_<n> articleId).

End with a single line: \`[summary] <≤ 12 words>\` if you proposed memory updates, or \`[noop] <reason>\` if nothing durable was learned.`

/** Input to `runLearnedExtraction()`. */
export interface LearnedExtractionInput {
  organizationId: string
  /** Whose Today feed receives the bundle. */
  ownerUserId: string
  threadId: string
  /** Record the resulting bundle anchors to (thread's primary entity or contact). */
  anchor: { entityInstanceId: string; entityDefinitionId: string }
  /** "provider:model" — same shape used elsewhere in kopilot. */
  modelId: string
}

/**
 * Run the learned-KB extractor once over a resolved thread, in capture mode.
 * The model sees the thread transcript, the linked records, and the AI Memory
 * catalog; proposed `upsert_learned_article` calls are captured (not executed)
 * and become an AiSuggestion bundle for the Today feed. Noise gates live in
 * the job, not here — by the time this runs the thread is worth an LLM call.
 */
export async function runLearnedExtraction(
  deps: HeadlessRunDeps,
  input: LearnedExtractionInput
): Promise<TypedResult<HeadlessRunResult, Error>> {
  const headlessTraceId = generateId('lrun')
  const computedForActivityAt = new Date()

  const thread = await deps.db.query.Thread.findFirst({
    where: and(
      eq(schema.Thread.id, input.threadId),
      eq(schema.Thread.organizationId, input.organizationId)
    ),
  })
  if (!thread) {
    return Result.error(new Error(`Thread ${input.threadId} not found`))
  }

  // Resolve the principal BEFORE the transcript read and the LLM call — an
  // extraction with no resolvable human is a no-op, not an unrestricted run
  // (doc 19 §2.3). Shares `resolveCaptureRunPrincipal` with the headless runner
  // so both capture paths bind identically.
  const principal = await resolveCaptureRunPrincipal({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  })
  if (!principal.ok) {
    logger.warn('Learned extraction skipped — no resolvable permission principal', {
      headlessTraceId,
      organizationId: input.organizationId,
      threadId: input.threadId,
      reason: principal.reason,
    })
    return Result.ok({
      actions: [],
      noopReason: `no_permission_principal: ${principal.reason}`,
      modelId: input.modelId,
      headlessTraceId,
      computedForActivityAt,
      computedForLatestMessageId: thread.latestMessageId ?? undefined,
      entityDefinitionId: input.anchor.entityDefinitionId,
    })
  }

  const prompt = await buildExtractionPrompt({
    db: deps.db,
    organizationId: input.organizationId,
    thread,
  })

  const getDeps: GetToolDeps = () => ({
    db: deps.db,
    organizationId: input.organizationId,
    userId: input.ownerUserId,
    sessionId: headlessTraceId,
    signal: undefined,
    turnId: headlessTraceId,
    // Doc 19 §2.3 — the knowledge / KB read tools and the learned write door are
    // all bounded by the bundle owner's own view.
    capabilities: principal.capabilities,
  })

  // Deliberately tight toolset: knowledge search + KB read tools for
  // read-then-merge, and the approval-gated learned write door. No mail /
  // entity / app tools — the transcript and record context are in the prompt.
  const registry = createCapabilityRegistry()
  registry.register(createKnowledgeCapabilities(getDeps))
  registry.register(createKbReadCapabilities(getDeps))
  registry.register(createLearnedKbCapabilities(getDeps))
  const tools = registry.getTools('mail')

  const [provider, ...modelParts] = input.modelId.split(':')
  const model = modelParts.join(':')
  if (!provider || !model) {
    return Result.error(new Error(`Invalid modelId "${input.modelId}" (expected "provider:model")`))
  }

  const agent = buildExtractionAgent({ tools, prompt })
  const engineConfig: AgentEngineConfig = {
    organizationId: input.organizationId,
    userId: input.ownerUserId,
    sessionId: headlessTraceId,
    db: deps.db,
    domainConfig: buildExtractionDomainConfig({ agent, model, provider }),
    callModel: deps.callModel,
    approvalMode: 'capture',
  }
  const engine = new AgentEngine(engineConfig)

  let finalText = ''
  try {
    for await (const event of engine.submitMessage('begin learned extraction')) {
      if (event.type === 'assistant-message-finished') {
        finalText = event.parts
          .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
          .map((p) => p.text)
          .join('')
      }
      if (event.type === 'turn-error') {
        logger.error('Learned extraction run errored', {
          headlessTraceId,
          threadId: input.threadId,
          error: event.error,
        })
        return Result.error(new Error(event.error))
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Learned extraction run threw', { headlessTraceId, error: msg })
    return Result.error(err instanceof Error ? err : new Error(msg))
  }

  const captured = engine.getState().capturedActions ?? []
  const actions = mergeActions([], captured)
  const parsed = parseFinalText(finalText)

  return Result.ok({
    actions,
    summary: parsed.summary,
    noopReason: parsed.noopReason,
    modelId: input.modelId,
    headlessTraceId,
    computedForActivityAt,
    computedForLatestMessageId: thread.latestMessageId ?? undefined,
    entityDefinitionId: input.anchor.entityDefinitionId,
  })
}

// ===== PROMPT BUILDER =====

interface BuildExtractionPromptParams {
  db: Database
  organizationId: string
  thread: typeof schema.Thread.$inferSelect
}

async function buildExtractionPrompt(params: BuildExtractionPromptParams): Promise<string> {
  const { db, organizationId, thread } = params
  const lines: string[] = []

  lines.push(`# Resolved conversation: ${thread.subject}`)
  lines.push(`threadId: ${thread.id}`)
  if (thread.lastMessageAt) lines.push(`lastMessageAt: ${thread.lastMessageAt.toISOString()}`)
  lines.push(`messageCount: ${thread.messageCount}`)

  // Linked records — recordIds the model can pass to upsert_learned_article.
  const linked = await loadLinkedRecords(db, organizationId, thread)
  if (linked.length > 0) {
    lines.push('')
    lines.push('## Linked records')
    for (const r of linked) {
      lines.push(
        `- ${r.role}: ${r.displayName ?? r.identifier ?? r.recordId} (recordId: ${r.recordId})`
      )
    }
  }

  // Transcript — most recent messages, oldest first.
  const transcript = await loadTranscript(db, organizationId, thread.id)
  lines.push('')
  lines.push('## Transcript')
  lines.push(transcript.length > 0 ? transcript.join('\n\n') : '(no message bodies available)')

  // AI Memory catalog — the learned KB only. This is the dedupe surface: the
  // model must see what already exists before writing.
  const catalog = await getCachedKbCatalog(organizationId)
  const learnedOnly = catalog.filter((kb) => kb.kind === 'learned')
  const rendered = renderKbCatalog(learnedOnly, { publicOnly: false, hasGetArticle: true })
  lines.push('')
  lines.push('## AI Memory catalog')
  lines.push(
    rendered ??
      'The AI Memory knowledge base is empty so far — any durable knowledge you save creates its first articles.'
  )

  lines.push('')
  lines.push(
    'Decide whether this conversation taught anything durable. If yes, save it via upsert_learned_article (update an existing article when one covers the topic). If not, end with [noop].'
  )

  return lines.join('\n')
}

interface LinkedRecord {
  role: string
  recordId: string
  displayName: string | null
  identifier: string | null
}

/**
 * The thread's primary entity plus the contact records of inbound senders —
 * rendered with recordIds so per-record memory articles can link them.
 */
async function loadLinkedRecords(
  db: Database,
  organizationId: string,
  thread: typeof schema.Thread.$inferSelect
): Promise<LinkedRecord[]> {
  const out: LinkedRecord[] = []
  const instanceIds = new Set<string>()

  if (thread.primaryEntityInstanceId && thread.primaryEntityDefinitionId) {
    instanceIds.add(thread.primaryEntityInstanceId)
    out.push({
      role: 'primary record',
      recordId: `${thread.primaryEntityDefinitionId}:${thread.primaryEntityInstanceId}`,
      displayName: null,
      identifier: null,
    })
  }

  // Inbound senders → their contact EntityInstances (when matched).
  const senders = await db
    .selectDistinct({
      name: schema.Participant.name,
      identifier: schema.Participant.identifier,
      entityInstanceId: schema.Participant.entityInstanceId,
    })
    .from(schema.Message)
    .innerJoin(schema.Participant, eq(schema.Participant.id, schema.Message.fromId))
    .where(
      and(
        eq(schema.Message.threadId, thread.id),
        eq(schema.Message.organizationId, organizationId),
        eq(schema.Message.isInbound, true)
      )
    )
    .limit(5)

  const contactInstanceIds = senders
    .map((s) => s.entityInstanceId)
    .filter((id): id is string => typeof id === 'string' && !instanceIds.has(id))
  const instances =
    contactInstanceIds.length > 0
      ? await db
          .select({
            id: schema.EntityInstance.id,
            entityDefinitionId: schema.EntityInstance.entityDefinitionId,
            displayName: schema.EntityInstance.displayName,
          })
          .from(schema.EntityInstance)
          .where(
            and(
              inArray(schema.EntityInstance.id, contactInstanceIds),
              eq(schema.EntityInstance.organizationId, organizationId)
            )
          )
      : []
  const instanceById = new Map(instances.map((i) => [i.id, i]))

  for (const sender of senders) {
    const instance = sender.entityInstanceId ? instanceById.get(sender.entityInstanceId) : undefined
    if (!instance || instanceIds.has(instance.id)) continue
    instanceIds.add(instance.id)
    out.push({
      role: 'contact',
      recordId: `${instance.entityDefinitionId}:${instance.id}`,
      displayName: instance.displayName ?? sender.name,
      identifier: sender.identifier,
    })
  }

  // Backfill the primary record's display name in one query.
  const primary = out.find((r) => r.role === 'primary record')
  if (primary && thread.primaryEntityInstanceId) {
    const row = await db.query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, thread.primaryEntityInstanceId),
      columns: { displayName: true },
    })
    primary.displayName = row?.displayName ?? null
  }

  return out
}

/** Last N messages as `[Customer|Agent - time]:\nbody` blocks, oldest first. */
async function loadTranscript(
  db: Database,
  organizationId: string,
  threadId: string
): Promise<string[]> {
  const rows = await db
    .select({
      textPlain: schema.Message.textPlain,
      textHtml: schema.Message.textHtml,
      snippet: schema.Message.snippet,
      isInbound: schema.Message.isInbound,
      sentAt: schema.Message.sentAt,
    })
    .from(schema.Message)
    .where(
      and(eq(schema.Message.threadId, threadId), eq(schema.Message.organizationId, organizationId))
    )
    .orderBy(asc(schema.Message.sentAt))

  return rows.slice(-TRANSCRIPT_MESSAGE_CAP).map((m) => {
    const body = (m.textPlain || stripHtml(m.textHtml || m.snippet || '')).trim()
    const capped =
      body.length > MESSAGE_BODY_CAP ? `${body.slice(0, MESSAGE_BODY_CAP)}… [truncated]` : body
    const direction = m.isInbound ? 'Customer' : 'Agent'
    const time = m.sentAt ? m.sentAt.toISOString() : 'unknown time'
    return `[${direction} - ${time}]:\n${capped}`
  })
}

// ===== MINIMAL AGENT/DOMAIN CONFIG =====

function buildExtractionAgent(opts: {
  tools: AgentToolDefinition[]
  prompt: string
}): AgentDefinition {
  return {
    name: 'learned-extraction-agent',
    tools: opts.tools,
    maxIterations: 8,
    async buildMessages(state: AgentState): Promise<Message[]> {
      const filtered = state.messages.filter((m) => m.role !== 'system')
      const wire = sessionMessagesToWire(filtered)
      // Replace the synthetic kickoff user message with the real prompt.
      if (wire.length > 0 && wire[0]?.role === 'user') {
        wire[0] = { role: 'user', content: opts.prompt }
      }
      return [{ role: 'system', content: EXTRACTION_SYSTEM_PROMPT }, ...wire]
    },
    async processResult(_c, _tc, state) {
      return state
    },
  }
}

function buildExtractionDomainConfig(opts: {
  agent: AgentDefinition
  model: string
  provider: string
}): AgentDomainConfig {
  return {
    type: 'kopilot',
    agents: { 'learned-extraction-agent': opts.agent },
    routes: [{ name: 'default', agents: ['learned-extraction-agent'] }],
    createInitialState: () => ({}),
    defaultModel: opts.model,
    defaultProvider: opts.provider,
  }
}
