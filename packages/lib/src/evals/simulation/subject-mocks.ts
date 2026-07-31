// packages/lib/src/evals/simulation/subject-mocks.ts

import type { SimulationConfig, SimulationToolMock } from '@auxx/types/evals'

/**
 * Derive tool mocks that make identity lookups agree with the simulation's own
 * customer.
 *
 * Why this exists: an unmocked tool falls back to its `exampleOutput` (see
 * `mock-tools.ts` and `plans/evals/live-tool-default-mocks-plan.md`) — a static
 * literal written to document the output schema, e.g. `search_entities` always
 * answers "Jane Cooper / Jane Doe". A simulation that configures a customer and
 * then has the agent look them up therefore gets contradicted by its own
 * fixtures: the agent correctly concludes the customer isn't on file, and the
 * run can never reach a terminal outcome. The failure reads as an agent defect.
 *
 * This does NOT change the resolution precedence. It prepends ordinary literal
 * mocks, so:
 *   - author-written mocks in `connectorMocks` still win (stored order),
 *   - anything not matched still falls through to `exampleOutput` exactly as before.
 *
 * Matching is deliberately narrow. `argsMatch` supports only deep equality, not
 * substring predicates, so these mocks fire only for a lookup that uses the
 * literal name or email the simulation was given. A search for anything else
 * (a product, an order) is left alone rather than being force-fed the customer.
 */

/** Stable synthetic record id for a claimed-only customer. */
const SUBJECT_RECORD_ID = 'contact:sim-subject'

/**
 * Entity keys that mean "the contact record type". `query_records` takes an
 * apiSlug, but the tool description shows the singular form, so models emit
 * either — cover both rather than guessing.
 */
const CONTACT_ENTITY_KEYS = ['contacts', 'contact'] as const

/**
 * Build the mocks for a simulation's customer. Returns `[]` when there is no
 * claimed identity to key off — nothing is inferred from an empty subject.
 */
export function buildSubjectMocks(config: SimulationConfig): SimulationToolMock[] {
  const claimed = config.subject?.claimed
  const name = claimed?.name?.trim()
  const email = claimed?.email?.trim()
  if (!name && !email) return []

  // Prefer a real linked record so the id the agent sees matches the one the
  // rest of the run (field overlay, assertions) is talking about.
  const recordId = config.subject?.recordIds?.[0] ?? SUBJECT_RECORD_ID
  const displayName = name ?? email ?? 'Customer'
  const secondaryInfo = email ?? null

  const searchItem = {
    recordId,
    displayName,
    entityType: 'contact',
    secondaryInfo,
  }
  const searchOutput = { items: [searchItem], count: 1 }

  const mocks: SimulationToolMock[] = []

  // One mock per literal the agent plausibly searches with. `subset` so an
  // accompanying `entityDefinitionId`/`limit` doesn't defeat the match.
  for (const term of [name, email]) {
    if (!term) continue
    mocks.push({
      id: `sim-subject-search-${term}`,
      toolName: 'search_entities',
      args: { mode: 'subset', value: { query: term } },
      output: searchOutput,
      usage: 'repeat',
    })
  }

  // `query_records` is the structured-filter sibling of `search_entities`, and
  // agents reach for it FIRST when narrowing a record type. Left uncovered it
  // hands back the example's contacts, the agent anchors on that record id, and
  // every later read/write in the run targets the wrong person — which is worse
  // than the original symptom, because it looks like it succeeded.
  //
  // Matched on the entity key rather than the filters: filter arrays are far too
  // variable for deep equality, but a query against the contact type is
  // unambiguously a query about the subject in a customer simulation. Queries
  // for any other entity type fall through untouched.
  for (const entityKey of CONTACT_ENTITY_KEYS) {
    mocks.push({
      id: `sim-subject-query-${entityKey}`,
      toolName: 'query_records',
      args: { mode: 'subset', value: { entity: entityKey } },
      output: {
        entityType: 'Contact',
        items: [{ recordId, displayName, secondaryInfo, ...(email ? { Email: email } : {}) }],
        returned_count: 1,
        total_matching: 1,
        hasMore: false,
      },
      usage: 'repeat',
    })
  }

  // Close the loop: the agent that found the subject above will read it back by
  // the recordId we just handed out.
  mocks.push({
    id: 'sim-subject-get-entity',
    toolName: 'get_entity',
    args: { mode: 'subset', value: { recordId } },
    output: {
      recordId,
      displayName,
      secondaryInfo,
      avatarUrl: null,
      fields: email ? { Email: { text: email, type: 'email' } } : {},
    },
    usage: 'repeat',
  })

  return mocks
}
