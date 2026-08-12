// packages/lib/src/workflow-engine/nodes/triggers/resource-trigger-base.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'

// Silence the logger. Partial mock: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Partial mock — the cache barrel is imported by half of lib; replacing it wholesale
// dies at collection. Only the two reads this processor makes are stubbed.
const getCachedResourceFields = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResourceFields: (...args: unknown[]) => getCachedResourceFields(...args),
  requireCachedEntityDefId: async () => 'contact',
}))

const { ResourceTriggerBase } = await import('./resource-trigger-base')

const TRIGGER_NODE_ID = 'trigger-001'

/** The two `contact` fields the filters below are written against. */
const CONTACT_FIELDS = [
  { id: 'fld_status', key: 'status', label: 'Status', systemAttribute: 'status' },
  { id: 'fld_email', key: 'email', label: 'Email', systemAttribute: 'email' },
]

/** The record snapshot shape `fetchResourceById` hands the trigger. */
const contactRecord = {
  id: 'contact-1',
  entityDefinitionId: 'contact',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  fieldValues: { status: 'active', email: 'jane@acme.com' },
}

const triggerNode = (filters?: unknown): WorkflowNode =>
  ({
    id: 'node-1',
    workflowId: 'workflow-1',
    nodeId: TRIGGER_NODE_ID,
    type: WorkflowNodeType.RESOURCE_TRIGGER,
    name: 'Contact Created',
    data: {
      id: 'node-1',
      type: WorkflowNodeType.RESOURCE_TRIGGER,
      title: 'Contact Created',
      resourceType: 'contact',
      operation: 'created',
      ...(filters === undefined ? {} : { filters }),
    },
  }) as unknown as WorkflowNode

/** One flat AND group, the shape the panel writes. */
const group = (...conditions: Array<Record<string, unknown>>) => [
  { id: 'g1', logicalOperator: 'AND', conditions },
]

function runContext() {
  const contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  contextManager.initializeWithTrigger({ data: { contact: contactRecord } } as never)
  return contextManager
}

async function run(filters?: unknown) {
  const contextManager = runContext()
  const processor = new ResourceTriggerBase()
  const result = await (processor as any).executeNode(triggerNode(filters), contextManager)
  return { result, contextManager }
}

/** True when the node result means "the workflow does not run". */
const didNotFire = (result: any) => result.status === NodeRunningStatus.Skipped

describe('ResourceTriggerBase trigger filters', () => {
  beforeEach(() => {
    getCachedResourceFields.mockReset()
    getCachedResourceFields.mockResolvedValue(CONTACT_FIELDS)
  })

  describe('no filter', () => {
    it('fires when `filters` is absent', async () => {
      const { result } = await run(undefined)
      expect(didNotFire(result)).toBe(false)
      expect(result.output.resourceType).toBe('contact')
    })

    it('fires when `filters` is an empty array', async () => {
      const { result } = await run([])
      expect(didNotFire(result)).toBe(false)
    })

    it('fires when the only group carries no conditions', async () => {
      const { result } = await run(group())
      expect(didNotFire(result)).toBe(false)
      // No field lookup is needed for an empty filter.
      expect(getCachedResourceFields).not.toHaveBeenCalled()
    })
  })

  describe('a filter that matches → fires', () => {
    it('matches on a field value', async () => {
      const { result } = await run(
        group({ id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'active' })
      )
      expect(didNotFire(result)).toBe(false)
      expect(result.output.data).toEqual(contactRecord)
    })

    it('matches through the shared operator semantics (`is` is case-insensitive)', async () => {
      // The unified `evaluateOperator` decided this — a private evaluator here would
      // silently disagree with record rules and the if-else node.
      const { result } = await run(
        group({ id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'ACTIVE' })
      )
      expect(didNotFire(result)).toBe(false)
    })

    it("ORs the group's conditions when the group says OR", async () => {
      // The panel derives `group.logicalOperator` from the condition rows, because
      // the shared flat list writes the AND/OR choice onto the conditions and the
      // evaluator reads only the group's. A group pinned to AND would drop the OR.
      const { result } = await run([
        {
          id: 'g1',
          logicalOperator: 'OR',
          conditions: [
            { id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'archived' },
            { id: 'c2', fieldId: 'contact:email', operator: 'contains', value: 'acme.com' },
          ],
        },
      ])
      expect(didNotFire(result)).toBe(false)
    })

    it('ANDs every condition in the group', async () => {
      const { result } = await run(
        group(
          { id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'active' },
          { id: 'c2', fieldId: 'contact:email', operator: 'contains', value: 'acme.com' }
        )
      )
      expect(didNotFire(result)).toBe(false)
    })
  })

  describe('a filter that does not match → does NOT fire', () => {
    it('skips on a non-matching value', async () => {
      const { result } = await run(
        group({ id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'archived' })
      )
      expect(didNotFire(result)).toBe(true)
      expect(result.output.reason).toBe('Did not pass trigger filters')
    })

    it('skips when one condition of an AND group fails', async () => {
      const { result } = await run(
        group(
          { id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'active' },
          { id: 'c2', fieldId: 'contact:email', operator: 'contains', value: 'other.com' }
        )
      )
      expect(didNotFire(result)).toBe(true)
    })

    it('publishes no variables when the filter rejects the record', async () => {
      const { result, contextManager } = await run(
        group({ id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'archived' })
      )
      expect(didNotFire(result)).toBe(true)
      expect(
        await contextManager.getVariable(`${TRIGGER_NODE_ID}.trigger.operation`)
      ).toBeUndefined()
    })
  })

  describe('a filter that does not compile → does NOT fire, and says so', () => {
    /** The refusal is reported at ERROR level, not swallowed as a plain non-match. */
    const errorLogs = (contextManager: ExecutionContextManager) =>
      contextManager.getContext().logs.filter((l) => l.level === 'ERROR')

    it('refuses on an unknown operator instead of firing on everything', async () => {
      // 🔴 The dangerous direction. `evaluateConditions` returns FALSE for an unknown
      // operator, so the plain evaluator would read this as "no match" and the author
      // would see a workflow that quietly stopped running. The diagnostics variant
      // reports it instead.
      const { result, contextManager } = await run(
        group({
          id: 'c1',
          fieldId: 'contact:status',
          operator: 'is_definitely_not_real',
          value: 'x',
        })
      )
      expect(didNotFire(result)).toBe(true)
      expect(result.output.reason).toContain('did not evaluate as written')
      expect(errorLogs(contextManager)).toHaveLength(1)
    })

    it('refuses when one condition of several is unreadable', async () => {
      // The rest of the filter matches — acting on the remainder is exactly the
      // "reduced to the bare scope" failure the invariant exists to prevent.
      const { result } = await run(
        group(
          { id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'active' },
          { id: 'c2', fieldId: 'contact:email', operator: 'nope', value: 'acme.com' }
        )
      )
      expect(didNotFire(result)).toBe(true)
      expect(result.output.reason).toContain('did not evaluate as written')
    })

    it('refuses an unresolved `currentUser` value source', async () => {
      const { result } = await run(
        group({
          id: 'c1',
          fieldId: 'contact:email',
          operator: 'is',
          value: undefined,
          valueSource: 'currentUser',
        })
      )
      expect(didNotFire(result)).toBe(true)
      expect(result.output.reason).toContain('did not evaluate as written')
    })

    it('refuses a variable-mode condition — a trigger has no upstream variables', async () => {
      const { result } = await run(
        group({
          id: 'c1',
          fieldId: 'contact:status',
          operator: 'is',
          value: '{{other.status}}',
          isConstant: false,
        })
      )
      expect(didNotFire(result)).toBe(true)
      expect(result.output.reason).toContain('cannot reference workflow variables')
    })

    it.each([
      ['an object rather than an array', { status: 'active' }],
      ['a string', 'status is active'],
      ['a group with no conditions array', [{ id: 'g1', logicalOperator: 'AND' }]],
      ['a condition with no operator', group({ id: 'c1', fieldId: 'contact:status' })],
    ])('refuses a filter shaped as %s', async (_label, filters) => {
      const { result } = await run(filters)
      expect(didNotFire(result)).toBe(true)
      expect(result.output.reason).toContain('did not evaluate as written')
    })

    it('refuses rather than firing when the resource has no cached fields', async () => {
      getCachedResourceFields.mockResolvedValue([])
      const { result } = await run(
        group({ id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'active' })
      )
      expect(didNotFire(result)).toBe(true)
      expect(result.output.reason).toContain('did not evaluate as written')
    })
  })
})

describe('ResourceTriggerBase.validateNodeConfig', () => {
  const validate = async (filters?: unknown) => {
    const processor = new ResourceTriggerBase()
    return (processor as any).validateNodeConfig(triggerNode(filters))
  }

  it('accepts a well-formed filter', async () => {
    const result = await validate(
      group({ id: 'c1', fieldId: 'contact:status', operator: 'is', value: 'active' })
    )
    expect(result.valid).toBe(true)
  })

  it('accepts no filter at all', async () => {
    expect((await validate(undefined)).valid).toBe(true)
  })

  it('rejects an unknown operator at save time', async () => {
    const result = await validate(
      group({ id: 'c1', fieldId: 'contact:status', operator: 'not_an_operator', value: 'x' })
    )
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('not_an_operator')
  })

  it('rejects a variable-mode condition at save time', async () => {
    const result = await validate(
      group({
        id: 'c1',
        fieldId: 'contact:status',
        operator: 'is',
        value: '{{x}}',
        isConstant: false,
      })
    )
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('workflow variables')
  })

  it('rejects a filter that is not condition groups', async () => {
    const result = await validate({ status: 'active' })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('array of condition groups')
  })
})
