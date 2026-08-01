// packages/lib/src/ai/kopilot/capabilities/entities/index.ts

import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import {
  createBulkUpdateEntityTool,
  createCreateEntityTool,
  createCreateNoteTool,
  createGetEntityHistoryTool,
  createGetEntityTool,
  createGetTranscriptTool,
  createListEntitiesTool,
  createListEntityFieldsTool,
  createListFieldChangesTool,
  createListNotesTool,
  createListTranscriptsForEntityTool,
  createQueryRecordsTool,
  createSearchEntitiesTool,
  createUpdateEntityTool,
} from './tools'

/**
 * Create the global entity capability set.
 * Discover/read/write tools for entities, plus rich-context retrieval (history,
 * comments, field changes, transcripts) used by both chat and the headless runner.
 * Registered as __global__ — available on all pages.
 */
export function createEntityCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [
      createListEntitiesTool(getDeps),
      createListEntityFieldsTool(getDeps),
      createSearchEntitiesTool(getDeps),
      createQueryRecordsTool(getDeps),
      createGetEntityTool(getDeps),
      createGetEntityHistoryTool(getDeps),
      createListNotesTool(getDeps),
      createCreateNoteTool(getDeps),
      createListFieldChangesTool(getDeps),
      createListTranscriptsForEntityTool(getDeps),
      createGetTranscriptTool(getDeps),
      createUpdateEntityTool(getDeps),
      createBulkUpdateEntityTool(getDeps),
      createCreateEntityTool(getDeps),
    ],
    systemPromptAddition: (ctx) => buildEntityPrompt(ctx),
    capabilities: (ctx) => buildEntityCapabilities(ctx),
  }
}

function buildEntityCapabilities({ toolNames }: SystemPromptAdditionContext): string[] {
  const has = (name: string) => toolNames.has(name)
  const bullets: string[] = []
  if (has('search_entities') || has('query_records')) {
    bullets.push('Search & find records like contacts, companies, tickets, and orders')
  }
  if (has('get_entity_history') || has('list_field_changes') || has('list_notes')) {
    bullets.push('Pull a record’s recent activity, threads, notes, tasks, and meetings in one shot')
  }
  if (has('create_note') && has('list_notes')) {
    bullets.push('Read and write internal notes (comments) on records')
  } else if (has('list_notes')) {
    bullets.push('Read internal notes (comments) on records')
  }
  if (has('get_transcript') || has('list_transcripts_for_entity')) {
    bullets.push('Read meeting transcripts')
  }
  if (has('create_entity')) {
    bullets.push('Create new records')
  }
  if (has('update_entity') || has('bulk_update_entity')) {
    bullets.push('Update existing records')
  }
  return bullets
}

/**
 * Compose the entity capability's prompt addition against the runtime tool
 * set. Each section is gated on the tools it actually requires so focused
 * pages (e.g. agents.builder) that exclude entity-writes don't see prose
 * telling the model to call tools it can't reach.
 */
function buildEntityPrompt({ toolNames }: SystemPromptAdditionContext): string {
  const has = (name: string) => toolNames.has(name)
  const bullets: string[] = []

  if (has('search_entities') && has('query_records')) {
    bullets.push(
      `- **\`search_entities\`** = text/fuzzy. **\`query_records\`** = structured filter. Field option values are uppercase codes ("ACTIVE"), not labels.`
    )
  } else if (has('search_entities')) {
    bullets.push(
      `- **\`search_entities\`** = text/fuzzy lookup. Field option values are uppercase codes ("ACTIVE"), not labels.`
    )
  } else if (has('query_records')) {
    bullets.push(
      `- **\`query_records\`** = structured filter. Field option values are uppercase codes ("ACTIVE"), not labels.`
    )
  }

  if (has('search_entities') || has('query_records')) {
    bullets.push(
      `- **Email threads and messages are not records.** The record tools reject them — conversations live behind \`find_threads\` / \`get_thread_detail\`. If those aren't available here, say so rather than querying an entity called "threads" or "messages".`
    )
  }

  if (has('search_entities') && has('list_entity_fields') && has('query_records')) {
    bullets.push(
      `- **Relational query** (e.g. "contacts at Google"): \`search_entities\` Google → \`list_entity_fields\` for contact → \`query_records\` filtering on the company field.`
    )
  }

  if (has('bulk_update_entity') && has('update_entity')) {
    bullets.push(
      `- **Bulk update**: \`bulk_update_entity\` for the same change on 2+ records; \`update_entity\` for single or heterogeneous.`
    )
  } else if (has('update_entity')) {
    bullets.push(`- **Update** a record with \`update_entity\`.`)
  }

  const hasGet = has('get_entity')
  if (hasGet) {
    bullets.push(
      `- **Listing → \`auxx:entity-list\`** is the default for any record list. **Comparing 2–3 records → \`auxx:table\`** with one column per record, one row per field (5–10 fields). Call \`get_entity\` per record first for comparisons (search payloads drop fields when matches >5). Never use markdown pipe tables.`
    )
  }

  if (bullets.length === 0) return ''
  return `## Entity flows\n\n${bullets.join('\n')}`
}
