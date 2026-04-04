// packages/database/src/db/schema/prompt-template.ts
// Reusable prompt templates for Kopilot

import { createId } from '@paralleldrive/cuid2'
import { index, jsonb, pgTable, sql, text, timestamp } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * Prompt templates that users can insert into the Kopilot composer via slash command.
 * organizationId = null means system/built-in (but those live in code, not DB).
 * DB rows always have an organizationId (user-created).
 */
export const PromptTemplate = pgTable(
  'PromptTemplate',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Template name (e.g., "Summarize Ticket") */
    name: text().notNull(),

    /** Short description of what the template does */
    description: text().notNull(),

    /** The actual prompt content that gets sent to Kopilot */
    prompt: text().notNull(),

    /** Categories for filtering (e.g., ["customer-support", "shopify"]) */
    categories: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    /** Icon with color for display */
    icon: jsonb().$type<{ iconId: string; color: string }>(),

    /** null = system/built-in template, non-null = org-specific custom template */
    organizationId: text().references(() => Organization.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** User who created this template */
    createdById: text().references(() => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),

    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('PromptTemplate_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('PromptTemplate_categories_idx').using('gin', table.categories),
  ]
)
