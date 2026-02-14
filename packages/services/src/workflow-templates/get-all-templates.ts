// packages/services/src/workflow-templates/get-all-templates.ts

import { database, schema } from '@auxx/database'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { GetWorkflowTemplatesInput, WorkflowTemplateListItem } from './types'

/**
 * Get all workflow templates with filtering and pagination
 *
 * @param input - Query parameters for filtering and pagination
 * @returns Result containing array of workflow templates (without graph data for performance)
 */
export async function getAllTemplates(input: GetWorkflowTemplatesInput = {}) {
  const { limit = 50, offset = 0, search, status = 'all', categories } = input

  const conditions = []

  // Status filter
  if (status !== 'all') {
    conditions.push(eq(schema.WorkflowTemplate.status, status))
  }

  // Search filter (name, description)
  if (search) {
    conditions.push(
      or(
        ilike(schema.WorkflowTemplate.name, `%${search}%`),
        ilike(schema.WorkflowTemplate.description, `%${search}%`)
      )
    )
  }

  // Category filter
  if (categories && categories.length > 0) {
    conditions.push(
      sql`${schema.WorkflowTemplate.categories}::jsonb ?| array[${sql.join(
        categories.map((c) => sql`${c}`),
        sql`, `
      )}]`
    )
  }

  const result = await fromDatabase(
    database
      .select({
        id: schema.WorkflowTemplate.id,
        name: schema.WorkflowTemplate.name,
        description: schema.WorkflowTemplate.description,
        categories: schema.WorkflowTemplate.categories,
        imgUrl: schema.WorkflowTemplate.imgUrl,
        version: schema.WorkflowTemplate.version,
        status: schema.WorkflowTemplate.status,
        triggerType: schema.WorkflowTemplate.triggerType,
        popularity: schema.WorkflowTemplate.popularity,
        createdAt: schema.WorkflowTemplate.createdAt,
        updatedAt: schema.WorkflowTemplate.updatedAt,
      })
      .from(schema.WorkflowTemplate)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.WorkflowTemplate.popularity), desc(schema.WorkflowTemplate.createdAt))
      .limit(limit)
      .offset(offset),
    'get-all-workflow-templates'
  )

  if (result.isErr()) {
    return result
  }

  return ok(result.value as WorkflowTemplateListItem[])
}
