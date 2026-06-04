// packages/lib/src/ai/agent-framework/context/__tests__/path-walker.test.ts

import { describe, expect, it } from 'vitest'
import { walkPath } from '../path-walker'

describe('walkPath', () => {
  it('returns the root for an empty path', () => {
    const root = { a: 1 }
    expect(walkPath(root, '')).toBe(root)
  })

  it('descends dotted object paths', () => {
    expect(walkPath({ contact: { email: 'x@y.z' } }, 'contact.email')).toBe('x@y.z')
  })

  it('returns undefined when an intermediate segment is missing', () => {
    expect(walkPath({ contact: {} }, 'contact.email.local')).toBeUndefined()
    expect(walkPath(null, 'a.b')).toBeUndefined()
  })

  describe('array navigation', () => {
    it('.first / .last', () => {
      expect(walkPath({ items: [1, 2, 3] }, 'items.first')).toBe(1)
      expect(walkPath({ items: [1, 2, 3] }, 'items.last')).toBe(3)
    })

    it('bare numeric index', () => {
      expect(walkPath({ items: [1, 2, 3] }, 'items.1')).toBe(2)
    })

    it('bracket index, positive and negative', () => {
      expect(walkPath({ items: [10, 20, 30] }, 'items[0]')).toBe(10)
      expect(walkPath({ items: [10, 20, 30] }, 'items[-1]')).toBe(30)
    })

    it('leading bracket when the root itself is an array', () => {
      expect(walkPath([{ name: 'a' }, { name: 'b' }], '[1].name')).toBe('b')
    })

    it('[*] returns the array itself when nothing follows', () => {
      const arr = [1, 2, 3]
      expect(walkPath({ items: arr }, 'items[*]')).toEqual(arr)
    })

    it('[*] maps the remaining path over each element', () => {
      const root = { orders: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
      expect(walkPath(root, 'orders[*].id')).toEqual(['a', 'b', 'c'])
    })

    it('returns undefined for an index on a non-array', () => {
      expect(walkPath({ items: 'nope' }, 'items[0]')).toBeUndefined()
    })

    it('navigates nested object.array.field chains', () => {
      expect(walkPath({ Variants: [{ Price: 10 }] }, 'Variants.first.Price')).toBe(10)
    })
  })

  describe('entity fieldValues fallback', () => {
    it('reads a field from the fieldValues map when not at the root', () => {
      const entity = { id: 'c1', fieldValues: { email: 'a@b.c' } }
      expect(walkPath(entity, 'email')).toBe('a@b.c')
    })

    it('prefers a root property over the fieldValues map', () => {
      const entity = { name: 'root', fieldValues: { name: 'fv' } }
      expect(walkPath(entity, 'name')).toBe('root')
    })
  })
})
