// packages/database/src/db/schema/dispatch-team-member.ts
// Self-referential team membership for dispatch (plans/dispatch/45-teams.md §3.2). Both sides are
// `DispatchWorker` rows: `teamWorkerId` must reference a `type:'team'` row, `memberWorkerId` a
// `type:'individual'` row (nesting disallowed, service-enforced §1.G). A worker can belong to many
// teams (many-to-many). Kept bespoke rather than reusing `EntityGroupMember` (§1.I) so a team stays
// one `DispatchWorker` row, not a group EntityInstance.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { DispatchWorker } from './dispatch-worker'
import { Organization } from './organization'

export const DispatchTeamMember = pgTable(
  'DispatchTeamMember',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** The team worker (must be `type:'team'`). */
    teamWorkerId: text()
      .notNull()
      .references((): AnyPgColumn => DispatchWorker.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /** The member worker (must be `type:'individual'`). */
    memberWorkerId: text()
      .notNull()
      .references((): AnyPgColumn => DispatchWorker.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('DispatchTeamMember_teamWorkerId_memberWorkerId_key').on(
      table.teamWorkerId,
      table.memberWorkerId
    ),
    // "which teams is this worker in" — my-schedule (§5.3), reverse lookup.
    index('DispatchTeamMember_memberWorkerId_idx').on(table.memberWorkerId),
  ]
)

export type DispatchTeamMemberEntity = typeof DispatchTeamMember.$inferSelect
export type DispatchTeamMemberInsert = typeof DispatchTeamMember.$inferInsert
