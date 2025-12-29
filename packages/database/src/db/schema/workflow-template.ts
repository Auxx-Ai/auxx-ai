// packages/database/src/db/schema/workflow-template.ts
// Workflow templates available to all organizations

import { pgTable, index, text, timestamp, integer, jsonb, sql } from './_shared'
import { createId } from '@paralleldrive/cuid2'

/**
 * Workflow templates available to all organizations
 * These are managed by super admins and can be used to quickly create workflows
 */
export const WorkflowTemplate = pgTable(
  'WorkflowTemplate',
  {
    /** Unique template ID */
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Template name (e.g., "Order Status Inquiry Handler") */
    name: text().notNull(),

    /** Detailed description of what the template does */
    description: text().notNull(),

    /** Categories for filtering (e.g., ["customer-service", "shopify"]) */
    categories: jsonb()
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Preview image URL for the template */
    imgUrl: text(),

    /** The complete workflow graph structure (nodes, edges, etc.) */
    graph: jsonb().notNull().default(sql`'{}'::jsonb`),

    /** Template version for tracking changes */
    version: integer().default(1).notNull(),

    /** Status: "public" (visible to all) or "hidden" (only visible to admins) */
    status: text().notNull().default('private'),

    /** Trigger type for the workflow (from WorkflowTriggerType enum) */
    triggerType: text(),

    /** Trigger configuration */
    triggerConfig: jsonb().$type<Record<string, any>>(),

    /** Environment variables template */
    envVars: jsonb().$type<
      Array<{
        id: string
        name: string
        value: any
        type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
      }>
    >(),

    /** Variables template */
    variables: jsonb().$type<any[]>(),

    /** How popular/recommended this template is (for sorting) */
    popularity: integer().default(0).notNull(),

    /** Created timestamp */
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),

    /** Last updated timestamp */
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => [
    // Index for filtering by status
    index('WorkflowTemplate_status_idx').using('btree', table.status.asc().nullsLast()),
    // Index for popularity sorting
    index('WorkflowTemplate_popularity_idx').using('btree', table.popularity.desc().nullsLast()),
    // Index for searching by name
    index('WorkflowTemplate_name_idx').using('btree', table.name.asc().nullsLast()),
    // Index for filtering by categories (GIN for jsonb array operations)
    index('WorkflowTemplate_categories_idx').using('gin', table.categories),
  ]
)
