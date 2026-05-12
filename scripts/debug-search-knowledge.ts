// scripts/debug-search-knowledge.ts
//
// Debug harness for the kopilot `search_knowledge` tool. Replicates the tool's
// dataset-resolution logic from
// packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-knowledge.ts
// and calls SearchService directly so we can tweak knobs the tool hardcodes
// (similarity threshold, hybrid weights, search type, includeInactive).
//
// Run with:
//   pnpm dotenv -- npx tsx scripts/debug-search-knowledge.ts <flags>
//
// Common flows:
//   --list-orgs                                  list organizations + ids
//   --org <id> --list-kbs                        list KBs + managed datasets
//   --org <id> --list-datasets                   list every dataset (managed + RAG)
//   --org <id> --query "..."                     run a hybrid search exactly like the tool
//   --org <id> --query "..." --threshold 0.4    lower vector threshold to surface near-misses
//   --org <id> --query "..." --type text         text-only (skip vector)
//   --org <id> --query "..." --type vector       vector-only
//   --org <id> --query "..." --include-inactive  include non-ACTIVE datasets
//   --json                                       dump raw JSON instead of pretty output
//
// Other flags:
//   --user <id>          run as a specific user (defaults to system user)
//   --source kb|rag|both default both
//   --kb <id>            narrow source=kb to a single KnowledgeBase
//   --datasets a,b,c     narrow source=rag to specific dataset ids
//   --records a,b,c      keep only segments whose metadata.links overlap these record ids
//   --limit N            default 5, capped at 10 to mirror the tool; raise via --raw-limit
//   --raw-limit N        bypass the 10 cap (sets SearchService limit directly)

import { closePools, database as db, schema } from '@auxx/database'
import { SearchService } from '@auxx/lib/datasets'
import { and, eq, inArray } from 'drizzle-orm'

type Source = 'kb' | 'rag' | 'both'

interface Args {
  org?: string
  user?: string
  query?: string
  source: Source
  kb?: string
  datasets?: string[]
  records?: string[]
  limit: number
  rawLimit?: number
  threshold?: number
  vectorWeight?: number
  textWeight?: number
  type: 'hybrid' | 'vector' | 'text'
  includeInactive: boolean
  listOrgs: boolean
  listKbs: boolean
  listDatasets: boolean
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    source: 'both',
    limit: 5,
    type: 'hybrid',
    includeInactive: false,
    listOrgs: false,
    listKbs: false,
    listDatasets: false,
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--org':
        out.org = next()
        break
      case '--user':
        out.user = next()
        break
      case '--query':
      case '-q':
        out.query = next()
        break
      case '--source':
        out.source = next() as Source
        break
      case '--kb':
        out.kb = next()
        break
      case '--datasets':
        out.datasets = next()
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case '--records':
        out.records = next()
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case '--limit':
        out.limit = Math.min(Number(next()), 10)
        break
      case '--raw-limit':
        out.rawLimit = Number(next())
        break
      case '--threshold':
        out.threshold = Number(next())
        break
      case '--vector-weight':
        out.vectorWeight = Number(next())
        break
      case '--text-weight':
        out.textWeight = Number(next())
        break
      case '--type':
        out.type = next() as Args['type']
        break
      case '--include-inactive':
        out.includeInactive = true
        break
      case '--list-orgs':
        out.listOrgs = true
        break
      case '--list-kbs':
        out.listKbs = true
        break
      case '--list-datasets':
        out.listDatasets = true
        break
      case '--json':
        out.json = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
      default:
        if (a?.startsWith('--')) {
          console.error(`Unknown flag: ${a}`)
          process.exit(1)
        }
    }
  }
  return out
}

function printHelp() {
  console.log(`debug-search-knowledge — see header of this file for usage`)
}

async function listOrgs() {
  const rows = await db
    .select({ id: schema.Organization.id, name: schema.Organization.name })
    .from(schema.Organization)
    .limit(50)
  for (const r of rows) console.log(`${r.id}\t${r.name ?? ''}`)
}

async function listKbs(organizationId: string) {
  const rows = await db
    .select({
      id: schema.KnowledgeBase.id,
      slug: schema.KnowledgeBase.slug,
      name: schema.KnowledgeBase.name,
      publishStatus: schema.KnowledgeBase.publishStatus,
      datasetId: schema.KnowledgeBase.datasetId,
    })
    .from(schema.KnowledgeBase)
    .where(eq(schema.KnowledgeBase.organizationId, organizationId))
  if (rows.length === 0) {
    console.log('(no KnowledgeBases for this org)')
    return
  }
  for (const r of rows) {
    console.log(
      `${r.id}\t${r.slug}\t${r.name}\tpublish=${r.publishStatus}\tdataset=${r.datasetId ?? '∅'}`
    )
  }
}

async function listDatasets(organizationId: string) {
  const rows = await db
    .select({
      id: schema.Dataset.id,
      name: schema.Dataset.name,
      isManaged: schema.Dataset.isManaged,
      status: schema.Dataset.status,
      embeddingModel: schema.Dataset.embeddingModel,
      vectorDimension: schema.Dataset.vectorDimension,
    })
    .from(schema.Dataset)
    .where(eq(schema.Dataset.organizationId, organizationId))
  if (rows.length === 0) {
    console.log('(no Datasets for this org)')
    return
  }
  for (const r of rows) {
    console.log(
      `${r.id}\tmanaged=${r.isManaged}\tstatus=${r.status}\tdim=${r.vectorDimension}\tmodel=${r.embeddingModel ?? '∅'}\t${r.name}`
    )
  }
}

/** Mirrors resolveDatasetIds() in search-knowledge.ts. */
async function resolveDatasetIds(args: {
  organizationId: string
  source: Source
  knowledgeBaseId?: string
  requestedDatasetIds?: string[]
}): Promise<string[]> {
  const { organizationId, source, knowledgeBaseId, requestedDatasetIds } = args

  const collectManaged = async () => {
    if (knowledgeBaseId) {
      const [kb] = await db
        .select({ datasetId: schema.KnowledgeBase.datasetId })
        .from(schema.KnowledgeBase)
        .where(
          and(
            eq(schema.KnowledgeBase.id, knowledgeBaseId),
            eq(schema.KnowledgeBase.organizationId, organizationId)
          )
        )
        .limit(1)
      return kb?.datasetId ? [kb.datasetId] : []
    }
    const rows = await db
      .select({ id: schema.Dataset.id })
      .from(schema.Dataset)
      .where(
        and(eq(schema.Dataset.organizationId, organizationId), eq(schema.Dataset.isManaged, true))
      )
    return rows.map((r) => r.id)
  }

  const collectRag = async () => {
    const rows = await db
      .select({ id: schema.Dataset.id })
      .from(schema.Dataset)
      .where(
        and(
          eq(schema.Dataset.organizationId, organizationId),
          eq(schema.Dataset.isManaged, false),
          requestedDatasetIds && requestedDatasetIds.length > 0
            ? inArray(schema.Dataset.id, requestedDatasetIds)
            : undefined
        )
      )
    return rows.map((r) => r.id)
  }

  if (source === 'kb') return collectManaged()
  if (source === 'rag') return collectRag()
  const [kb, rag] = await Promise.all([collectManaged(), collectRag()])
  return [...new Set([...kb, ...rag])]
}

async function runSearch(args: Args) {
  if (!args.org) throw new Error('--org is required for search')
  if (!args.query) throw new Error('--query is required for search')

  const datasetIds = await resolveDatasetIds({
    organizationId: args.org,
    source: args.source,
    knowledgeBaseId: args.kb,
    requestedDatasetIds: args.datasets,
  })

  console.log('---')
  console.log(`org:            ${args.org}`)
  console.log(`query:          ${JSON.stringify(args.query)}`)
  console.log(`source:         ${args.source}`)
  console.log(`type:           ${args.type}`)
  console.log(`threshold:      ${args.threshold ?? '(default 0.7)'}`)
  console.log(`weights:        v=${args.vectorWeight ?? '(0.6)'} t=${args.textWeight ?? '(0.4)'}`)
  console.log(`include-inactive: ${args.includeInactive}`)
  console.log(`datasets resolved (pre-status filter): ${datasetIds.length}`)
  for (const id of datasetIds) console.log(`  - ${id}`)
  console.log('---')

  if (datasetIds.length === 0) {
    console.log('No accessible datasets — short-circuit (same as tool message).')
    return
  }

  const limit =
    args.rawLimit ??
    (args.records && args.records.length > 0 ? Math.max(args.limit * 3, 10) : args.limit)

  const queryPayload: Record<string, unknown> = {
    query: args.query,
    datasetIds,
    limit,
    searchType: args.type,
    includeMetadata: true,
    includeInactive: args.includeInactive,
  }
  if (args.threshold !== undefined) queryPayload.similarityThreshold = args.threshold
  if (args.vectorWeight !== undefined) queryPayload.vectorWeight = args.vectorWeight
  if (args.textWeight !== undefined) queryPayload.textWeight = args.textWeight

  const t0 = Date.now()
  const response = await SearchService.search(queryPayload as any, args.org, args.user)
  const elapsed = Date.now() - t0

  const filtered =
    args.records && args.records.length > 0
      ? response.results.filter((r) => {
          const links = (r.segment.metadata as any)?.links as
            | Array<{ recordId: string }>
            | undefined
          if (!links || links.length === 0) return false
          return links.some((l) => args.records!.includes(l.recordId))
        })
      : response.results

  const trimmed = filtered.slice(0, args.limit)

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          elapsedMs: elapsed,
          total: response.total,
          filtered: filtered.length,
          returned: trimmed.length,
          results: trimmed,
        },
        null,
        2
      )
    )
    return
  }

  console.log(`elapsed:        ${elapsed}ms`)
  console.log(`total hits:     ${response.total}`)
  console.log(`after records:  ${filtered.length}`)
  console.log(`returned:       ${trimmed.length}`)
  console.log('---')

  if (trimmed.length === 0) {
    console.log('No matching results.')
    console.log('Hint: try --threshold 0.4, --type text, --include-inactive, or --source both.')
    return
  }

  for (const [i, r] of trimmed.entries()) {
    const meta = (r.segment.metadata as any) ?? {}
    const isKb = meta.source === 'kb'
    const docSlug =
      isKb && meta.kbSlug && meta.articleSlugPath
        ? `${meta.kbSlug}/${meta.articleSlugPath}`
        : undefined
    const title = r.segment.document.title || '(untitled)'
    console.log(
      `#${i + 1}  score=${r.score.toFixed(3)}  type=${r.searchType}  ${isKb ? 'KB' : 'RAG'}  ${title}`
    )
    if (docSlug) console.log(`     auxx://doc/${docSlug}`)
    console.log(
      `     dataset=${r.segment.document.dataset.name} (${r.segment.document.dataset.id})`
    )
    const snippet =
      r.segment.content.length > 240 ? `${r.segment.content.slice(0, 240)}…` : r.segment.content
    console.log(`     ${snippet.replace(/\s+/g, ' ').trim()}`)
    console.log()
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL not set — run via `pnpm dotenv -- npx tsx scripts/debug-search-knowledge.ts ...`'
    )
    process.exit(1)
  }
  const args = parseArgs(process.argv.slice(2))

  if (args.listOrgs) {
    await listOrgs()
    return
  }
  if (args.listKbs) {
    if (!args.org) throw new Error('--list-kbs requires --org')
    await listKbs(args.org)
    return
  }
  if (args.listDatasets) {
    if (!args.org) throw new Error('--list-datasets requires --org')
    await listDatasets(args.org)
    return
  }
  await runSearch(args)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePools()
  })
