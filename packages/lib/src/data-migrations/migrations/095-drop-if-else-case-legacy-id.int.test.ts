// packages/lib/src/data-migrations/migrations/095-drop-if-else-case-legacy-id.int.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { migration095DropIfElseCaseLegacyId as migration } from './095-drop-if-else-case-legacy-id'

/**
 * The key drop against a real Postgres.
 *
 * Two things are actually at stake and neither is expressible against a mocked
 * `db`. First, the migration rewrites three independent jsonb columns in three
 * independent loops, so "idempotent" has to be proved three times. Second, the
 * thing it must NOT do — move a branch handle — is only visible by reading the
 * stored `case_id`s and `edge.sourceHandle`s back out of the column afterwards.
 *
 * Idempotency is asserted on Postgres's `xmin` (the transaction id stamped on
 * every row version), not on column values. `Workflow.updatedAt` carries no
 * `$onUpdate` and `WorkflowRun` has no `updatedAt` at all, so an UPDATE that
 * writes an identical graph would be invisible to a value comparison. `xmin`
 * changes on every physical row write, so an unchanged `xmin` is proof that the
 * second pass issued no UPDATE — not merely that the values matched.
 */

/** A legacy if-else node: two ids per case, the readable one in the retired slot. */
const legacyGraph = () => ({
  nodes: [
    { id: 'trigger-1', data: { type: 'manual', title: 'Start' } },
    {
      id: 'if-else-1',
      data: {
        type: 'if-else',
        title: 'Check Order',
        cases: [
          {
            id: 'case_has_order',
            case_id: 'true',
            logical_operator: 'and',
            conditions: [{ id: 'c1', variableId: 'Order.id', comparison_operator: 'is_not_empty' }],
          },
          {
            id: 'case_email_mismatch',
            case_id: 'case_email_mismatch',
            logical_operator: 'and',
            conditions: [{ id: 'c2', variableId: 'Order.email', comparison_operator: 'is' }],
          },
        ],
      },
    },
    { id: 'wait-1', data: { type: 'wait', title: 'Matched' } },
    { id: 'wait-2', data: { type: 'wait', title: 'Mismatch' } },
    { id: 'wait-3', data: { type: 'wait', title: 'Otherwise' } },
  ],
  edges: [
    { id: 'e0', source: 'trigger-1', target: 'if-else-1', sourceHandle: 'source' },
    { id: 'e1', source: 'if-else-1', target: 'wait-1', sourceHandle: 'true' },
    { id: 'e2', source: 'if-else-1', target: 'wait-2', sourceHandle: 'case_email_mismatch' },
    { id: 'e3', source: 'if-else-1', target: 'wait-3', sourceHandle: 'false' },
  ],
})

/** A graph with no if-else node at all — the migration must not write it. */
const unrelatedGraph = () => ({
  nodes: [
    { id: 'trigger-1', data: { type: 'manual', title: 'Start' } },
    {
      id: 'classifier-1',
      data: { type: 'text-classifier', title: 'Sort', classes: [{ id: 'category-1', name: 'A' }] },
    },
  ],
  edges: [{ id: 'e0', source: 'trigger-1', target: 'classifier-1' }],
})

type Graph = ReturnType<typeof legacyGraph>

describe('migration 095 — drop the retired if-else cases[].id', () => {
  let db: Database
  let organizationId: string
  let workflowAppId: string

  beforeEach(async () => {
    db = getTestDb() as unknown as Database
    organizationId = (await createTestOrganization()).id

    const [app] = await db
      .insert(schema.WorkflowApp)
      .values({ organizationId, name: 'Test App', updatedAt: new Date('2026-01-01T00:00:00.000Z') })
      .returning({ id: schema.WorkflowApp.id })
    workflowAppId = app!.id
  })

  const createWorkflow = async (graph: unknown): Promise<string> => {
    const [row] = await db
      .insert(schema.Workflow)
      .values({
        organizationId,
        workflowAppId,
        name: 'Order Lookup',
        graph: graph as any,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning({ id: schema.Workflow.id })
    return row!.id
  }

  const createTemplate = async (graph: unknown): Promise<string> => {
    const [row] = await db
      .insert(schema.WorkflowTemplate)
      .values({
        name: 'Order Lookup Template',
        description: 'Admin-authored template',
        graph: graph as any,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning({ id: schema.WorkflowTemplate.id })
    return row!.id
  }

  const createRun = async (workflowId: string, graph: unknown): Promise<string> => {
    const [row] = await db
      .insert(schema.WorkflowRun)
      .values({
        organizationId,
        workflowAppId,
        workflowId,
        sequenceNumber: 1,
        type: 'workflow',
        triggeredFrom: 'APP_RUN',
        version: '1',
        graph: graph as any,
        inputs: {},
        status: 'SUCCEEDED',
      })
      .returning({ id: schema.WorkflowRun.id })
    return row!.id
  }

  const readGraph = async (table: any, id: string): Promise<Graph> => {
    const [row] = await db.select({ graph: table.graph }).from(table).where(eq(table.id, id))
    return row!.graph as Graph
  }

  /** The row-version stamp. Changes on every physical UPDATE, identical otherwise. */
  const readXmin = async (table: any, id: string): Promise<string> => {
    const [row] = await db
      .select({ xmin: sql<string>`xmin::text` })
      .from(table)
      .where(eq(table.id, id))
    return row!.xmin
  }

  const ifElseCases = (graph: Graph): Array<Record<string, unknown>> =>
    (graph.nodes.find((n) => n.id === 'if-else-1')!.data as any).cases

  // ── What it drops ───────────────────────────────────────────────────────────

  describe('the key', () => {
    it.each([
      ['Workflow', () => schema.Workflow],
      ['WorkflowTemplate', () => schema.WorkflowTemplate],
      ['WorkflowRun', () => schema.WorkflowRun],
    ])('drops cases[].id from a legacy if-else node in %s.graph', async (label, table) => {
      const workflowId = await createWorkflow(legacyGraph())
      const id =
        label === 'Workflow'
          ? workflowId
          : label === 'WorkflowTemplate'
            ? await createTemplate(legacyGraph())
            : await createRun(workflowId, legacyGraph())

      await migration.run(db)

      const cases = ifElseCases(await readGraph(table(), id))
      expect(cases).toHaveLength(2)
      for (const caseItem of cases) expect(caseItem).not.toHaveProperty('id')
    })

    it('leaves every case_id exactly where it was', async () => {
      // The readable string lived in the key being dropped; the ADDRESS is
      // `case_id` and none of it may move, including the legacy `'true'`.
      const id = await createWorkflow(legacyGraph())

      await migration.run(db)

      expect(ifElseCases(await readGraph(schema.Workflow, id)).map((c) => c.case_id)).toEqual([
        'true',
        'case_email_mismatch',
      ])
    })

    it('leaves every edge on its original handle', async () => {
      // The whole point of the direction chosen in plan 28 §2 decision 2: edges
      // already store `case_id`, so there is zero edge migration. If a run of
      // this could move a handle, it is wrong.
      const before = legacyGraph().edges
      const id = await createWorkflow(legacyGraph())

      await migration.run(db)

      expect((await readGraph(schema.Workflow, id)).edges).toEqual(before)
    })

    it('leaves conditions[].id alone — that one is still bookkeeping', async () => {
      const id = await createWorkflow(legacyGraph())

      await migration.run(db)

      const cases = ifElseCases(await readGraph(schema.Workflow, id))
      expect((cases[0]!.conditions as Array<{ id: string }>).map((c) => c.id)).toEqual(['c1'])
      expect((cases[1]!.conditions as Array<{ id: string }>).map((c) => c.id)).toEqual(['c2'])
    })
  })

  // ── What it must not touch ──────────────────────────────────────────────────

  describe('scope', () => {
    it('never writes a graph with no if-else node', async () => {
      // `text-classifier` carries `classes[].id`, which IS its branch handle — a
      // blanket "drop nested id" would destroy every classifier route.
      const id = await createWorkflow(unrelatedGraph())
      const before = await readXmin(schema.Workflow, id)

      await migration.run(db)

      expect(await readGraph(schema.Workflow, id)).toEqual(unrelatedGraph())
      expect(await readXmin(schema.Workflow, id)).toBe(before)
    })

    it('never writes an if-else node that is already on the new shape', async () => {
      const clean = legacyGraph()
      for (const caseItem of ifElseCases(clean)) delete caseItem.id
      const id = await createWorkflow(clean)
      const before = await readXmin(schema.Workflow, id)

      await migration.run(db)

      expect(await readXmin(schema.Workflow, id)).toBe(before)
    })

    it('survives a row with a null or shapeless graph', async () => {
      const nullGraph = await createWorkflow(null)
      const noNodes = await createWorkflow({ edges: [] })

      await expect(migration.run(db)).resolves.toBeUndefined()

      expect(await readGraph(schema.Workflow, nullGraph)).toBeNull()
      expect(await readGraph(schema.Workflow, noNodes)).toEqual({ edges: [] })
    })
  })

  // ── Idempotency, per column ─────────────────────────────────────────────────

  describe('idempotency', () => {
    it('issues zero UPDATEs on a second run, on all three columns', async () => {
      const workflowId = await createWorkflow(legacyGraph())
      const templateId = await createTemplate(legacyGraph())
      const runId = await createRun(workflowId, legacyGraph())

      await migration.run(db)

      const afterFirst = {
        workflow: await readGraph(schema.Workflow, workflowId),
        template: await readGraph(schema.WorkflowTemplate, templateId),
        run: await readGraph(schema.WorkflowRun, runId),
      }
      const xminAfterFirst = {
        workflow: await readXmin(schema.Workflow, workflowId),
        template: await readXmin(schema.WorkflowTemplate, templateId),
        run: await readXmin(schema.WorkflowRun, runId),
      }

      await migration.run(db)

      expect(await readGraph(schema.Workflow, workflowId)).toEqual(afterFirst.workflow)
      expect(await readGraph(schema.WorkflowTemplate, templateId)).toEqual(afterFirst.template)
      expect(await readGraph(schema.WorkflowRun, runId)).toEqual(afterFirst.run)

      expect(await readXmin(schema.Workflow, workflowId)).toBe(xminAfterFirst.workflow)
      expect(await readXmin(schema.WorkflowTemplate, templateId)).toBe(xminAfterFirst.template)
      expect(await readXmin(schema.WorkflowRun, runId)).toBe(xminAfterFirst.run)
    })

    it('leaves updatedAt alone even on the pass that rewrites the row', async () => {
      // The key nothing reads is being dropped; nobody's view of the workflow
      // changes, so a migration must not report itself as a user edit.
      const id = await createWorkflow(legacyGraph())

      await migration.run(db)

      const [row] = await db
        .select({ updatedAt: schema.Workflow.updatedAt })
        .from(schema.Workflow)
        .where(eq(schema.Workflow.id, id))
      expect(row!.updatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    })
  })
})
