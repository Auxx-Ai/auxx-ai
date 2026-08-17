// packages/database/src/db/schema/participant.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  identifierType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'

import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

/** Drizzle table for participant */
export const Participant = pgTable(
  'Participant',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    identifier: text().notNull(),
    identifierType: identifierType().notNull(),
    name: text(),
    displayName: text(),
    initials: text(),
    isSpammer: boolean().default(false).notNull(),
    /** True when the participant's identifier is on the organization's own domain. Set at create time; recompute on org domain change. */
    isInternal: boolean().default(false).notNull(),
    /** Reference to EntityInstance (contact entity type) */
    entityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
    firstInteractionDate: timestamp({ precision: 3 }),
    firstInteractionType: text(),
    hasReceivedMessage: boolean().default(false).notNull(),
    lastSentMessageAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('Participant_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
    index('Participant_identifierType_idx').using('btree', table.identifierType.asc().nullsLast()),
    index('Participant_identifier_idx').using('btree', table.identifier.asc().nullsLast()),
    uniqueIndex('Participant_organizationId_identifier_identifierType_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.identifier.asc().nullsLast(),
      table.identifierType.asc().nullsLast()
    ),
    index('Participant_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),

    // ─────────────────────────────────────────────────────────────────────────
    // Ranked recipient search (plans/email-editor/recipient-search.md §3)
    // ─────────────────────────────────────────────────────────────────────────
    //
    // 🔴 **These two are a set — one of them missing costs BOTH.** The search
    // predicate is an OR block (fuzzy `%` on displayName, `ILIKE` on
    // displayName, `ILIKE` on identifier) and Postgres builds it as a
    // `BitmapOr` of one index scan per arm. An arm with no index condition
    // forces it to abandon the others too and filter the whole org slice.
    // Measured on 200k rows / 10k per org: **0.35 ms** with both indexes,
    // **32.6 ms** with only the identifier one (`Rows Removed by Filter: 9999`),
    // for a byte-identical result. Same failure mode as
    // `EntityInstance_org_secondaryDisplayValue_trgm_idx` (migration 0321).
    //
    // Org-scoped composites, matching the GIN indexes from migration 0058 —
    // which is where `pg_trgm` and `btree_gin` are installed; `btree_gin` is
    // what lets `organizationId` lead a GIN index.
    index('Participant_org_displayName_trgm_idx').using(
      'gin',
      table.organizationId,
      table.displayName.op('gin_trgm_ops')
    ),
    // Serves email substring search (`jane` → `jane@corp.com`) AND phone-number
    // search: stored identifiers are E.164, and the query is normalized to
    // digit patterns before it gets here (§3.5), so the arm is
    // `identifier ILIKE '%4155551234%'`. Measured on 200k E.164 numbers with
    // realistic area-code clustering: 0.53 ms for 7 digits, 0.38 ms at the
    // 3-digit trigram floor. No digits column or reverse-prefix index needed.
    index('Participant_org_identifier_trgm_idx').using(
      'gin',
      table.organizationId,
      table.identifier.op('gin_trgm_ops')
    ),
    // The empty-query path: focusing a recipient field lists most-recently-mailed
    // (§3.6), which is a straight index scan rather than a ranked search.
    // `DESC NULLS LAST` is explicit because Postgres defaults `DESC` to
    // NULLS FIRST — and the never-mailed rows are exactly what must sort last.
    index('Participant_org_lastSent_idx').using(
      'btree',
      table.organizationId.asc(),
      table.lastSentMessageAt.desc().nullsLast()
    ),
    // ⚠️ There is deliberately NO trigram index on `name`, and the search
    // predicate must not carry a `name ILIKE` arm either. `name` is redundant
    // with `displayName` **by construction**: `calculateDisplayName` returns the
    // trimmed name whenever one exists, and every write site sets the two
    // together — all four inserts (`ingest/participants/find-or-create.ts`,
    // `participants/participant-service.ts`, `chat/visitor-identity.ts`,
    // `chat-widget/visitor.ts`) and both opaque update paths
    // (`updateVisitorClaimedIdentity`, `chat/passport.ts`) assign
    // `name = displayName = trimmed`. So no query can match `name` without
    // matching `displayName`, and an extra GIN index would cost write
    // throughput for zero recall. **If a future write path sets `name` alone,
    // that invariant breaks and this comment is the thing to revisit.**
    //
    // ⚠️ `displayName` stays NULLABLE and the index is on the bare column, not
    // `COALESCE("displayName", identifier)`. Nulls are real — 403 of 15 244 rows,
    // and 29% in one live org — but a row with no name cannot be found by
    // fuzzy-matching a name it does not have; it is reachable through the
    // identifier arm, which is separately indexed above. NOT NULL is also not
    // available: `_calculateDisplayInfo` returns `undefined` when both name and
    // identifier are blank, and ingest must never throw.
  ]
)

export type ParticipantEntity = typeof Participant.$inferSelect
export type CreateParticipantInput = typeof Participant.$inferInsert
export type UpdateParticipantInput = Partial<CreateParticipantInput>
