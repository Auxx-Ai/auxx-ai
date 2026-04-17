// packages/database/src/db/schema/free-tool-lead.ts
// Drizzle table: freeToolLead — leads captured from /free-tools/* pages

import { createId } from '@paralleldrive/cuid2'
import { index, pgTable, text, timestamp } from './_shared'

/** Lead captured from a free-tool landing page (name + email in exchange for a downloadable asset). */
export const FreeToolLead = pgTable(
  'FreeToolLead',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    email: text().notNull(),
    name: text(),
    /** Slug of the free tool that captured this lead, e.g. 'invoice-generator' */
    toolSlug: text().notNull(),
    referrer: text(),
    utmSource: text(),
    utmMedium: text(),
    utmCampaign: text(),
    ipAddress: text(),
    userAgent: text(),
  },
  (table) => [
    index('FreeToolLead_toolSlug_idx').using('btree', table.toolSlug.asc().nullsLast()),
    index('FreeToolLead_email_idx').using('btree', table.email.asc().nullsLast()),
    index('FreeToolLead_createdAt_idx').using('btree', table.createdAt.desc().nullsLast()),
  ]
)
