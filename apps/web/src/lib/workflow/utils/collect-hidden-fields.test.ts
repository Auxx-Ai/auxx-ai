// apps/web/src/lib/workflow/utils/collect-hidden-fields.test.ts

import { describe, expect, it } from 'vitest'
import { collectHiddenFields } from './collect-hidden-fields'

/** Build a ConditionalRender node with a serialized `shouldRender` result. */
const cond = (shouldRender: boolean, children: any[]) => ({
  instance_type: 'instance',
  component: 'ConditionalRenderInternal',
  attributes: { shouldRender },
  children,
})

/** Build an input field node carrying its `name`. */
const field = (name: string) => ({
  instance_type: 'instance',
  component: 'StringInputInternal',
  attributes: { name },
  children: [],
})

/** Wrap children in a layout node (no name, no condition) — should be transparent. */
const layout = (children: any[]) => ({
  instance_type: 'instance',
  component: 'SectionInternal',
  attributes: {},
  children,
})

describe('collectHiddenFields', () => {
  it('returns [] for a null/empty tree', () => {
    expect(collectHiddenFields(null)).toEqual([])
    expect(collectHiddenFields(undefined)).toEqual([])
    expect(collectHiddenFields({ children: [] })).toEqual([])
  })

  it('does not hide fields outside any ConditionalRender', () => {
    const tree = { children: [field('operation'), field('connectionId')] }
    expect(collectHiddenFields(tree)).toEqual([])
  })

  it('hides fields under a shouldRender=false ConditionalRender', () => {
    const tree = {
      children: [
        cond(true, [field('getOrderId')]),
        cond(false, [field('getManyLimit'), field('getManyStatus')]),
      ],
    }
    expect(collectHiddenFields(tree)).toEqual(['getManyLimit', 'getManyStatus'])
  })

  it('finds fields nested deep inside layout wrappers', () => {
    const tree = {
      children: [cond(false, [layout([layout([field('getOrderId')])])])],
    }
    expect(collectHiddenFields(tree)).toEqual(['getOrderId'])
  })

  it('treats a hidden ancestor as dominant over a visible nested condition', () => {
    const tree = {
      children: [cond(false, [cond(true, [field('createEmail')])])],
    }
    expect(collectHiddenFields(tree)).toEqual(['createEmail'])
  })

  it('hides a field under a nested shouldRender=false even when the outer is visible', () => {
    const tree = {
      children: [cond(true, [field('createEmail'), cond(false, [field('createTestFlag')])])],
    }
    expect(collectHiddenFields(tree)).toEqual(['createTestFlag'])
  })

  it('de-duplicates and sorts', () => {
    const tree = {
      children: [cond(false, [field('b'), field('a'), field('b')])],
    }
    expect(collectHiddenFields(tree)).toEqual(['a', 'b'])
  })
})
