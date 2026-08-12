// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/relation-utils.test.ts

import { describe, expect, it } from 'vitest'
import { createResourceReference } from '../../../types/resource-reference'
import { parseRelationInput } from '../relation-utils'

describe('parseRelationInput', () => {
  describe('empty values', () => {
    it.each([null, undefined, '', '   ', [], {}])('yields no ids for %j', (value) => {
      expect(parseRelationInput(value)).toEqual([])
    })
  })

  describe('strings', () => {
    it('takes a bare id', () => {
      expect(parseRelationInput('ticket_1')).toEqual(['ticket_1'])
    })

    it('passes a RecordId through whole', () => {
      expect(parseRelationInput('ticket_def:ticket_1')).toEqual(['ticket_def:ticket_1'])
    })

    it('trims', () => {
      expect(parseRelationInput('  ticket_1  ')).toEqual(['ticket_1'])
    })
  })

  describe('arrays', () => {
    it("flattens the picker's RecordId[] and drops empties", () => {
      expect(parseRelationInput(['tag_def:tag_1', '', 'tag_def:tag_2'])).toEqual([
        'tag_def:tag_1',
        'tag_def:tag_2',
      ])
    })

    it('flattens mixed shapes', () => {
      expect(parseRelationInput([{ id: 'a' }, 'b', [{ referenceId: 'c' }]])).toEqual([
        'a',
        'b',
        'c',
      ])
    })
  })

  describe('ResourceReference (find-node output)', () => {
    it('unwraps the reference a find node actually emits', () => {
      const ref = createResourceReference('ticket', 'ticket_1', 'org_1')

      expect(parseRelationInput(ref)).toEqual(['ticket_1'])
    })

    it('unwraps a bare __resourceRef object', () => {
      expect(
        parseRelationInput({ __resourceRef: true, resourceType: 'contact', resourceId: 'c_1' })
      ).toEqual(['c_1'])
    })

    it('unwraps an array of references', () => {
      expect(
        parseRelationInput([
          createResourceReference('ticket', 'ticket_1', 'org_1'),
          createResourceReference('ticket', 'ticket_2', 'org_1'),
        ])
      ).toEqual(['ticket_1', 'ticket_2'])
    })

    it('ignores resourceId without the __resourceRef marker', () => {
      expect(parseRelationInput({ resourceType: 'ticket', resourceId: 'ticket_1' })).toEqual([])
    })
  })

  describe('object precedence matches extractIdFromValue (base-node.ts)', () => {
    it('prefers .id', () => {
      expect(parseRelationInput({ id: 'from_id', referenceId: 'from_reference' })).toEqual([
        'from_id',
      ])
    })

    it('falls back to __resourceRef.resourceId, then referenceId', () => {
      expect(
        parseRelationInput({
          __resourceRef: true,
          resourceId: 'from_resource',
          referenceId: 'from_reference',
        })
      ).toEqual(['from_resource'])
      expect(parseRelationInput({ referenceId: 'from_reference' })).toEqual(['from_reference'])
    })

    it('yields nothing for an object carrying no recognised id key', () => {
      expect(parseRelationInput({ name: 'Ada', email: 'ada@example.com' })).toEqual([])
    })
  })
})
