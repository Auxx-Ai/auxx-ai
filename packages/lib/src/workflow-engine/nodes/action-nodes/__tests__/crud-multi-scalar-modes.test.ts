// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/crud-multi-scalar-modes.test.ts
//
// Multi-value SCALAR fields (`options.multi` on EMAIL/URL/PHONE/…) ride the same
// per-field update-mode system as multi-relation and MULTI_SELECT (plan
// 04-multi-email B4). The two guarantees pinned here:
//   1. `preprocessNode` wraps a multi-scalar update value with
//      `{ values, updateMode }` — default mode `replace` (locked) — so the
//      executor can never treat it as a bare whole-value set.
//   2. `executeEntityOperation` honors the mode: `add`/`remove` route through the
//      row-level `FieldValueService.addValues`/`removeValues` primitives and the
//      field NEVER reaches the whole-field `updateValues` set (no alias-list
//      wipe); `replace` stays a whole-field set of the parsed array.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { BaseType, WorkflowNodeType } from '../../../core/types'
import { CrudNodeProcessor } from '../crud'

const spies = vi.hoisted(() => ({
  updateValues: vi.fn(),
  addValues: vi.fn(),
  removeValues: vi.fn(),
  addRelationValues: vi.fn(),
  removeRelationValues: vi.fn(),
}))

/** Contact-shaped resource: one multi EMAIL field, one plain TEXT field. */
const contactResource = {
  id: 'contact',
  entityDefinitionId: 'def_contact',
  fields: [
    {
      id: 'cf_email',
      key: 'primary_email',
      label: 'Email',
      type: BaseType.STRING,
      fieldType: 'EMAIL',
      options: { multi: true },
    },
    {
      id: 'cf_first_name',
      key: 'first_name',
      label: 'First name',
      type: BaseType.STRING,
      fieldType: 'TEXT',
    },
  ],
}

vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  findCachedResource: vi.fn(async (_organizationId: string, resourceType: string) =>
    resourceType === 'contact' ? contactResource : null
  ),
}))

// Class stubs, not `vi.fn().mockImplementation(arrow)` — the executor calls
// `new UnifiedCrudHandler(...)` and an arrow implementation is not constructable.
vi.mock('../../../../resources/crud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../resources/crud')>()),
  UnifiedCrudHandler: class {
    updateValues = spies.updateValues
  },
}))

vi.mock('../../../../field-values/field-value-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../field-values/field-value-service')>()),
  FieldValueService: class {
    addValues = spies.addValues
    removeValues = spies.removeValues
    addRelationValues = spies.addRelationValues
    removeRelationValues = spies.removeRelationValues
  },
}))

const crudNode = (nodeId: string, data: Partial<NodeData>): WorkflowNode => ({
  id: nodeId,
  workflowId: 'workflow_1',
  nodeId,
  name: nodeId,
  type: WorkflowNodeType.CRUD,
  data: { id: nodeId, type: WorkflowNodeType.CRUD, title: nodeId, ...data },
  metadata: { position: { x: 0, y: 0 } },
})

describe('CrudNodeProcessor — multi-value scalar update modes', () => {
  let processor: CrudNodeProcessor
  let contextManager: any

  beforeEach(() => {
    vi.clearAllMocks()
    spies.updateValues.mockResolvedValue({ entityInstance: { id: 'rec_1' }, id: 'rec_1' })
    spies.addValues.mockResolvedValue([])
    spies.removeValues.mockResolvedValue(undefined)

    processor = new CrudNodeProcessor()
    contextManager = {
      getVariable: vi.fn((path: string) => {
        if (path === 'sys.organizationId') return 'org_test'
        if (path === 'sys.userId') return 'user_test'
        return undefined
      }),
      resolveVariablePath: vi.fn(async (path: string) => {
        if (path === 'find1.contact.email') return ['a@x.com', 'b@x.com']
        if (path === 'trigger.mode') return 'ADD'
        return undefined
      }),
      interpolateVariables: vi.fn(async (text: string) => text),
      setNodeVariable: vi.fn(),
      log: vi.fn(),
    }
  })

  describe('preprocessNode', () => {
    it('wraps a multi-scalar update with values + the locked default mode (replace)', async () => {
      const node = crudNode('n1', {
        resourceType: 'contact',
        mode: 'update',
        resourceId: 'rec_1',
        data: { primary_email: 'new@x.com', first_name: 'Bob' },
      })

      const result = await processor.preprocessNode(node, contextManager)

      expect(result.inputs.data.primary_email).toEqual({
        values: ['new@x.com'],
        updateMode: 'replace',
        fieldType: 'EMAIL',
      })
      // Plain scalar fields stay untouched — no wrapper.
      expect(result.inputs.data.first_name).toBe('Bob')
    })

    it('honors an explicit add mode from fieldUpdateModes', async () => {
      const node = crudNode('n2', {
        resourceType: 'contact',
        mode: 'update',
        resourceId: 'rec_1',
        data: { primary_email: 'alias@x.com' },
        fieldUpdateModes: { primary_email: 'add' },
      })

      const result = await processor.preprocessNode(node, contextManager)

      expect(result.inputs.data.primary_email).toEqual({
        values: ['alias@x.com'],
        updateMode: 'add',
        fieldType: 'EMAIL',
      })
    })

    it('keeps the array shape when a variable resolves to multiple values', async () => {
      const node = crudNode('n3', {
        resourceType: 'contact',
        mode: 'update',
        resourceId: 'rec_1',
        data: { primary_email: '{{find1.contact.email}}' },
      })

      const result = await processor.preprocessNode(node, contextManager)

      expect(result.inputs.data.primary_email).toEqual({
        values: ['a@x.com', 'b@x.com'],
        updateMode: 'replace',
        fieldType: 'EMAIL',
      })
    })

    it('parses a JSON-stringified array (frontend idiom shared with MULTI_SELECT)', async () => {
      const node = crudNode('n4', {
        resourceType: 'contact',
        mode: 'update',
        resourceId: 'rec_1',
        data: { primary_email: '["a@x.com","b@x.com"]' },
      })

      const result = await processor.preprocessNode(node, contextManager)

      expect(result.inputs.data.primary_email).toEqual({
        values: ['a@x.com', 'b@x.com'],
        updateMode: 'replace',
        fieldType: 'EMAIL',
      })
    })

    it('resolves a dynamic mode variable to a runtime mode', async () => {
      const node = crudNode('n5', {
        resourceType: 'contact',
        mode: 'update',
        resourceId: 'rec_1',
        data: { primary_email: 'alias@x.com' },
        fieldUpdateModes: { primary_email: 'dynamic' },
        fieldUpdateModeVars: { primary_email: '{{trigger.mode}}' },
      })

      const result = await processor.preprocessNode(node, contextManager)

      expect(result.inputs.data.primary_email).toMatchObject({ updateMode: 'add' })
      expect(result.inputs.fieldUpdateModes).toEqual({ primary_email: 'add' })
    })

    it('does not wrap on create — create passes the raw value through', async () => {
      const node = crudNode('n6', {
        resourceType: 'contact',
        mode: 'create',
        data: { primary_email: 'new@x.com' },
      })

      const result = await processor.preprocessNode(node, contextManager)

      expect(result.inputs.data.primary_email).toBe('new@x.com')
    })

    it('leaves an empty value on the plain lane (no-write, never a list wipe)', async () => {
      const node = crudNode('n7', {
        resourceType: 'contact',
        mode: 'update',
        resourceId: 'rec_1',
        data: { primary_email: '' },
      })

      const result = await processor.preprocessNode(node, contextManager)

      // Empty strings are dropped by the existing cleanup — the key is absent,
      // so the executor writes nothing for this field.
      expect(result.inputs.data).not.toHaveProperty('primary_email')
    })
  })

  describe('executeEntityOperation — mode honored, no list wipe', () => {
    const execute = (data: Record<string, unknown>) =>
      (processor as any).executeEntityOperation(
        contactResource,
        'update',
        'rec_1',
        data,
        contextManager
      )

    it('add mode appends via addValues and never reaches the whole-field set', async () => {
      await execute({
        primary_email: { values: ['alias@x.com'], updateMode: 'add', fieldType: 'EMAIL' },
        first_name: 'Bob',
      })

      expect(spies.addValues).toHaveBeenCalledWith(
        expect.objectContaining({ fieldId: 'cf_email', values: ['alias@x.com'] })
      )
      expect(spies.removeValues).not.toHaveBeenCalled()
      // The whole-field update carries ONLY the plain field — the multi scalar
      // must not ride the DELETE-all-then-INSERT set path (list wipe).
      expect(spies.updateValues).toHaveBeenCalledWith('rec_1', { cf_first_name: 'Bob' })
    })

    it('remove mode deletes the named values via removeValues', async () => {
      await execute({
        primary_email: { values: ['alias@x.com'], updateMode: 'remove', fieldType: 'EMAIL' },
      })

      expect(spies.removeValues).toHaveBeenCalledWith(
        expect.objectContaining({ fieldId: 'cf_email', values: ['alias@x.com'] })
      )
      expect(spies.addValues).not.toHaveBeenCalled()
      expect(spies.updateValues).toHaveBeenCalledWith('rec_1', {})
    })

    it('replace mode is a whole-field set of the parsed array', async () => {
      await execute({
        primary_email: { values: ['only@x.com'], updateMode: 'replace', fieldType: 'EMAIL' },
      })

      expect(spies.updateValues).toHaveBeenCalledWith('rec_1', { cf_email: ['only@x.com'] })
      expect(spies.addValues).not.toHaveBeenCalled()
      expect(spies.removeValues).not.toHaveBeenCalled()
    })
  })
})
