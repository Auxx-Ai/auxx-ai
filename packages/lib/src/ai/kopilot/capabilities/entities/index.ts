// packages/lib/src/ai/kopilot/capabilities/entities/index.ts

import type { GetToolDeps, PageCapability } from '../types'
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
    systemPromptAddition: `## Entity flows

### Relational queries (e.g. "contacts at Google")
1. \`search_entities\` → find "Google" record, note its recordId
2. \`list_entity_fields\` for contact → find the company/relationship field
3. \`query_records\` → filter contacts where the field = Google's recordId (or dot notation)

### Creating new entities
Before calling \`create_entity\`, run \`search_entities\` first with a query built
from the values the user gave you (name, email, SKU, etc.) scoped to the same
\`entityDefinitionId\`. This catches obvious duplicates before the user has to
approve a redundant create.

A duplicate is a search result that probably represents the **same** entity:
same full name, same email, or same phone (for people/companies); same SKU or
identifier (for things). Records that share only part of a name (e.g. last
name only) are NOT duplicates — searching "Cornelia Klooth" and getting back
"Lutz Klooth", "Carolin Klooth", "Christoph Klooth" is just a last-name match;
none of those are Cornelia. Proceed with the create.

Only stop and ask the user if at least one result is a real duplicate by the
rule above. Otherwise proceed straight to \`list_entity_fields\` →
\`create_entity\` as usual. Skip the dedupe step entirely when the user has
explicitly said "create a new one even if it exists" or similar.

### Comparing records

Decide between \`auxx:table\` and \`auxx:entity-list\` by what the user is
asking *about*:

- **Comparing the records themselves** ("compare X with Y", "X vs Y",
  "diff these two", "show them side-by-side") → \`auxx:table\`. One
  column per record (labeled with the displayName), one row per field.
  Pick 5–10 fields that make the comparison meaningful (status, email,
  revenue, assignee, notable custom fields).
- **A related set drawn from those records** ("primary contacts for both
  companies", "tickets on both accounts", "orders for these customers")
  → \`auxx:entity-list\` with the related records' recordIds. This is a
  list of related items, not a comparison of the parents.

When you do emit a table, call \`get_entity\` on each record first —
search results drop fields when matches >5, so you can't rely on the
search payload for the full field set. Never write comparisons as
markdown pipe tables; use the block.

### Bulk updates
Use \`bulk_update_entity\` with all recordIds when updating the same fields on 2+ records. Use \`update_entity\` only for single records or heterogeneous changes.

### Important
- search_entities = TEXT search (fuzzy name match)
- query_records = STRUCTURED filtering
- Field option values are uppercase codes (e.g. "ACTIVE"), not display labels`,
    capabilities: [
      'Search & find records like contacts, companies, tickets, and orders',
      'Pull a record’s recent activity, threads, notes, tasks, and meetings in one shot',
      'Read and write internal notes (comments) on records',
      'Read meeting transcripts',
      'Create new records',
      'Update existing records',
    ],
  }
}
