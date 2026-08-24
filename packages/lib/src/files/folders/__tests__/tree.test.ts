// packages/lib/src/files/folders/__tests__/tree.test.ts

/**
 * `folders/tree.ts` — the pure hierarchy core.
 *
 * **This file builds no doubles at all**, not even the `files/` db stub: every
 * function under test takes plain data and returns plain data
 * (`plans/attachments/09-testing-strategy.md` §9.2, shape 1). That is the whole
 * point of PR 5d — the same algorithms were reachable only through a `db`-bound
 * service before, and the three defects asserted below had therefore never been
 * exercised.
 *
 * The interesting cases are the pathological ones, so they get most of the file:
 * self-parenting, two- and three-node cycles, a node moved under its own
 * descendant, a chain deep enough to blow a recursive implementation, orphans
 * whose parent is not in the set, duplicate sibling names, and names carrying
 * unicode, whitespace and `LIKE` metacharacters.
 *
 * The last three `describe`s are property-style: a deterministic PRNG builds a
 * random forest and the invariants are asserted over every node in it, rather
 * than over one hand-picked example.
 */

import { describe, expect, it } from 'vitest'
import type { FolderNode } from '../tree'
import {
  ancestorsOf,
  buildFolderTree,
  computePath,
  computeTreeShape,
  descendantsOf,
  driftedShapes,
  escapeLikePattern,
  indexById,
  indexByParent,
  isAncestorOf,
  isValidFolderName,
  joinPath,
  normalizeParentId,
  pathPrefix,
  ROOT_PATH,
  wouldCreateCycle,
} from '../tree'

/** A node with plausible-but-obviously-fake path/depth unless overridden. */
function node(
  id: string,
  parentId: string | null,
  name = id,
  overrides: Partial<FolderNode> = {}
): FolderNode {
  return { id, parentId, name, path: `/${id}`, depth: 0, ...overrides }
}

/** `a -> b -> c -> …`, `length` deep, rooted at `n0`. */
function chain(length: number): FolderNode[] {
  return Array.from({ length }, (_, i) => node(`n${i}`, i === 0 ? null : `n${i - 1}`))
}

// ============= Path arithmetic =============

describe('joinPath', () => {
  it.each([
    [null, 'Docs', '/Docs'],
    [undefined, 'Docs', '/Docs'],
    ['/', 'Docs', '/Docs'],
    ['', 'Docs', '/Docs'],
    ['/Docs', 'Invoices', '/Docs/Invoices'],
    ['/Docs/', 'Invoices', '/Docs/Invoices'],
    ['/a//b', 'c', '/a/b/c'],
    ['Docs', 'Invoices', '/Docs/Invoices'],
    ['/Docs', 'Rechnungen für 2026', '/Docs/Rechnungen für 2026'],
    ['/Docs', '発注書', '/Docs/発注書'],
    ['/Docs', '100% off', '/Docs/100% off'],
    ['/Docs', 'a_b', '/Docs/a_b'],
  ])('joinPath(%p, %p) === %p', (parent, name, expected) => {
    expect(joinPath(parent as string | null | undefined, name)).toBe(expected)
  })

  it('always produces an absolute path', () => {
    for (const parent of [null, '', '/', 'x', '/x', '//x']) {
      expect(joinPath(parent, 'child').startsWith('/')).toBe(true)
    }
  })
})

describe('pathPrefix', () => {
  it.each([
    [null, ROOT_PATH],
    [undefined, ROOT_PATH],
    ['/', ROOT_PATH],
    ['/Doc', '/Doc/'],
    ['/Documents', '/Documents/'],
  ])('pathPrefix(%p) === %p', (path, expected) => {
    expect(pathPrefix(path as string | null | undefined)).toBe(expected)
  })

  it('distinguishes a folder from a longer-named sibling — the delete-cascade bug', () => {
    // `'/Documents/report.pdf'.startsWith('/Doc')` is true, which is what the
    // legacy `ilike(FolderFile.path, `${folder.path}%`)` asked. With the
    // trailing slash it is false, which is what it meant to ask.
    expect('/Documents/report.pdf'.startsWith('/Doc')).toBe(true)
    expect('/Documents/report.pdf'.startsWith(pathPrefix('/Doc'))).toBe(false)
    expect('/Doc/report.pdf'.startsWith(pathPrefix('/Doc'))).toBe(true)
  })
})

describe('escapeLikePattern', () => {
  it.each([
    ['plain', 'plain'],
    ['100% off', '100\\% off'],
    ['a_b', 'a\\_b'],
    ['back\\slash', 'back\\\\slash'],
    ['%_\\', '\\%\\_\\\\'],
  ])('escapeLikePattern(%p) === %p', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected)
  })
})

describe('isValidFolderName', () => {
  it.each([
    ['Docs', true],
    ['Rechnungen für 2026', true],
    ['発注書', true],
    ['100% off', true],
    ['a_b', true],
    ['  padded  ', true],
    ['', false],
    ['   ', false],
    ['a/b', false],
    ['a\\b', false],
    ['a:b', false],
    ['a*b', false],
    ['a?b', false],
    ['a"b', false],
    ['a<b', false],
    ['a>b', false],
    ['a|b', false],
  ])('isValidFolderName(%p) === %p', (name, expected) => {
    expect(isValidFolderName(name)).toBe(expected)
  })
})

describe('normalizeParentId', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['root', null],
    ['fld_1', 'fld_1'],
  ])('normalizeParentId(%p) === %p', (input, expected) => {
    expect(normalizeParentId(input as string | null | undefined)).toBe(expected)
  })
})

describe('computePath', () => {
  it('is /name at the root', () => {
    expect(computePath([], 'Docs')).toBe('/Docs')
  })

  it('concatenates the ancestor chain root-first', () => {
    expect(computePath([{ name: 'a' }, { name: 'b' }], 'c')).toBe('/a/b/c')
  })

  it('handles a 500-deep chain without recursing', () => {
    const ancestors = Array.from({ length: 500 }, (_, i) => ({ name: `n${i}` }))
    const path = computePath(ancestors, 'leaf')
    expect(path.startsWith('/n0/n1/n2/')).toBe(true)
    expect(path.endsWith('/leaf')).toBe(true)
    expect(path.split('/').filter(Boolean)).toHaveLength(501)
  })

  it('preserves unicode and metacharacters verbatim', () => {
    expect(computePath([{ name: '発注書' }, { name: '100% off' }], 'a_b')).toBe(
      '/発注書/100% off/a_b'
    )
  })

  it('agrees with a fold over joinPath, which is how the mutations build it', () => {
    const names = ['a', 'b', 'c', 'd']
    const folded = names.reduce<string | null>((path, name) => joinPath(path, name), null)
    expect(
      computePath(
        names.slice(0, -1).map((name) => ({ name })),
        'd'
      )
    ).toBe(folded)
  })
})

// ============= Walks =============

describe('ancestorsOf', () => {
  it('returns the chain root-first and excludes the node itself', () => {
    const index = indexById(chain(4))
    expect(ancestorsOf(index, 'n3').map((n) => n.id)).toEqual(['n0', 'n1', 'n2'])
  })

  it('is empty for a root', () => {
    expect(ancestorsOf(indexById(chain(3)), 'n0')).toEqual([])
  })

  it('is empty for a node that is not in the index', () => {
    expect(ancestorsOf(indexById(chain(3)), 'missing')).toEqual([])
  })

  it('stops at a parent that is not in the set, rather than throwing', () => {
    // `n1`'s parent `n0` was filtered out by `deletedAt IS NULL`.
    const index = indexById([node('n1', 'n0'), node('n2', 'n1')])
    expect(ancestorsOf(index, 'n2').map((n) => n.id)).toEqual(['n1'])
  })

  it('terminates on a self-parenting node', () => {
    const index = indexById([node('a', 'a')])
    expect(ancestorsOf(index, 'a')).toEqual([])
  })

  it('terminates on a two-node cycle — the legacy loop did not', () => {
    const index = indexById([node('a', 'b'), node('b', 'a')])
    expect(ancestorsOf(index, 'a').map((n) => n.id)).toEqual(['b'])
    expect(ancestorsOf(index, 'b').map((n) => n.id)).toEqual(['a'])
  })

  it('terminates on a three-node cycle', () => {
    const index = indexById([node('a', 'c'), node('b', 'a'), node('c', 'b')])
    expect(ancestorsOf(index, 'a').map((n) => n.id)).toEqual(['b', 'c'])
  })

  it('walks a 2,000-deep chain iteratively', () => {
    const index = indexById(chain(2000))
    expect(ancestorsOf(index, 'n1999')).toHaveLength(1999)
  })
})

describe('descendantsOf', () => {
  it('is breadth-first and excludes the node itself', () => {
    const nodes = [
      node('root', null),
      node('a', 'root'),
      node('b', 'root'),
      node('a1', 'a'),
      node('a2', 'a'),
      node('a1x', 'a1'),
    ]
    expect(descendantsOf(nodes, 'root').map((n) => n.id)).toEqual(['a', 'b', 'a1', 'a2', 'a1x'])
  })

  it('is empty for a leaf', () => {
    expect(descendantsOf(chain(3), 'n2')).toEqual([])
  })

  it('is empty for a node that is not in the set', () => {
    expect(descendantsOf(chain(3), 'missing')).toEqual([])
  })

  it('visits each node once when a cycle sits below the start', () => {
    const nodes = [node('root', null), node('a', 'root'), node('b', 'a'), node('c', 'b')]
    // Close the loop: `a`'s parent becomes `c`, so a -> b -> c -> a.
    const cyclic = nodes.map((n) => (n.id === 'a' ? { ...n, parentId: 'c' } : n))
    expect(descendantsOf(cyclic, 'a').map((n) => n.id)).toEqual(['b', 'c'])
  })

  it('handles a 2,000-deep chain', () => {
    expect(descendantsOf(chain(2000), 'n0')).toHaveLength(1999)
  })

  it('keeps duplicate sibling names as distinct nodes', () => {
    const nodes = [node('root', null), node('x', 'root', 'Docs'), node('y', 'root', 'Docs')]
    expect(descendantsOf(nodes, 'root').map((n) => n.id)).toEqual(['x', 'y'])
  })
})

// ============= Cycle detection =============

describe('wouldCreateCycle', () => {
  const nodes = [
    node('root', null),
    node('a', 'root'),
    node('b', 'a'),
    node('c', 'b'),
    node('other', 'root'),
  ]

  it('is false for a move to the root', () => {
    expect(wouldCreateCycle(nodes, 'a', null)).toBe(false)
  })

  it('is true for self-parenting', () => {
    expect(wouldCreateCycle(nodes, 'a', 'a')).toBe(true)
  })

  it('is true for a move under a direct child', () => {
    expect(wouldCreateCycle(nodes, 'a', 'b')).toBe(true)
  })

  it('is true for a move under a distant descendant', () => {
    expect(wouldCreateCycle(nodes, 'a', 'c')).toBe(true)
  })

  it('is false for a move under an unrelated branch', () => {
    expect(wouldCreateCycle(nodes, 'a', 'other')).toBe(false)
  })

  it('is false for a move under an ancestor — a no-op, not a cycle', () => {
    expect(wouldCreateCycle(nodes, 'c', 'a')).toBe(false)
  })

  it('is false for a target that does not exist', () => {
    expect(wouldCreateCycle(nodes, 'a', 'missing')).toBe(false)
  })

  it('does not depend on the path column, which the legacy check did', () => {
    // Every path is deliberately wrong; the answer must come from `parentId`.
    const stale = nodes.map((n) => ({ ...n, path: '/wrong' }))
    expect(wouldCreateCycle(stale, 'a', 'c')).toBe(true)
    expect(wouldCreateCycle(stale, 'a', 'other')).toBe(false)
  })

  it('terminates when the graph already contains a cycle', () => {
    const cyclic = [node('a', 'c'), node('b', 'a'), node('c', 'b'), node('z', null)]
    expect(wouldCreateCycle(cyclic, 'z', 'b')).toBe(false)
    expect(wouldCreateCycle(cyclic, 'a', 'b')).toBe(true)
  })

  it('accepts a prebuilt index as well as an array', () => {
    expect(wouldCreateCycle(indexById(nodes), 'a', 'c')).toBe(true)
  })

  it('is false at every level of a 2,000-deep chain moved upward', () => {
    const deep = chain(2000)
    expect(wouldCreateCycle(deep, 'n1999', 'n0')).toBe(false)
    expect(wouldCreateCycle(deep, 'n0', 'n1999')).toBe(true)
  })
})

describe('isAncestorOf', () => {
  const nodes = [node('root', null), node('a', 'root'), node('b', 'a')]

  it.each([
    ['root', 'b', true],
    ['a', 'b', true],
    ['b', 'a', false],
    ['a', 'a', false],
    ['missing', 'b', false],
  ])('isAncestorOf(%p, %p) === %p', (ancestor, descendant, expected) => {
    expect(isAncestorOf(nodes, ancestor, descendant)).toBe(expected)
  })
})

// ============= Shape recomputation =============

describe('computeTreeShape', () => {
  it('derives path and depth from the parent chain', () => {
    const nodes = [
      node('root', null, 'Docs', { path: '/nonsense', depth: 9 }),
      node('a', 'root', 'Invoices', { path: '/nonsense', depth: 9 }),
      node('b', 'a', '2026', { path: '/nonsense', depth: 9 }),
    ]
    expect(computeTreeShape(nodes)).toEqual([
      { id: 'root', path: '/Docs', depth: 0 },
      { id: 'a', path: '/Docs/Invoices', depth: 1 },
      { id: 'b', path: '/Docs/Invoices/2026', depth: 2 },
    ])
  })

  it('treats a node whose parent is absent as a root', () => {
    const nodes = [node('orphan', 'gone', 'Orphan', { path: '/x', depth: 4 })]
    expect(computeTreeShape(nodes)).toEqual([{ id: 'orphan', path: '/Orphan', depth: 0 }])
  })

  it('terminates on a cycle', () => {
    const nodes = [node('a', 'b', 'A'), node('b', 'a', 'B')]
    const shapes = computeTreeShape(nodes)
    expect(shapes).toHaveLength(2)
    for (const shape of shapes) expect(shape.depth).toBe(1)
  })
})

describe('driftedShapes', () => {
  it('reports only the rows whose stored path or depth is wrong', () => {
    const nodes = [
      node('root', null, 'Docs', { path: '/Docs', depth: 0 }),
      node('ok', 'root', 'Fine', { path: '/Docs/Fine', depth: 1 }),
      node('badPath', 'root', 'Bad', { path: '/Docs/Stale', depth: 1 }),
      node('badDepth', 'root', 'Deep', { path: '/Docs/Deep', depth: 7 }),
    ]
    expect(driftedShapes(nodes).map((s) => s.id)).toEqual(['badPath', 'badDepth'])
  })

  it('is empty for a consistent hierarchy', () => {
    const nodes = [
      node('root', null, 'Docs', { path: '/Docs', depth: 0 }),
      node('a', 'root', 'A', { path: '/Docs/A', depth: 1 }),
    ]
    expect(driftedShapes(nodes)).toEqual([])
  })
})

// ============= Tree assembly =============

describe('buildFolderTree', () => {
  it('nests children under their parent', () => {
    const nodes = [node('root', null), node('a', 'root'), node('a1', 'a')]
    const tree = buildFolderTree(nodes)
    expect(tree).toHaveLength(1)
    expect(tree[0]?.children.map((c) => c.id)).toEqual(['a'])
    expect(tree[0]?.children[0]?.children.map((c) => c.id)).toEqual(['a1'])
  })

  it('folds in aggregates, and defaults to zero without them', () => {
    const nodes = [node('root', null), node('a', 'root')]
    const tree = buildFolderTree(nodes, new Map([['root', { fileCount: 3, totalSize: 900 }]]))
    expect(tree[0]).toMatchObject({ fileCount: 3, totalSize: 900 })
    expect(tree[0]?.children[0]).toMatchObject({ fileCount: 0, totalSize: 0 })
  })

  it('surfaces an orphan as a root instead of dropping it', () => {
    // The legacy builder pushed to the roots only when `!folder.parentId`, so a
    // folder whose parent had been soft-deleted appeared nowhere in the tree.
    const nodes = [node('root', null), node('orphan', 'deleted-parent')]
    expect(
      buildFolderTree(nodes)
        .map((n) => n.id)
        .sort()
    ).toEqual(['orphan', 'root'])
  })

  it('emits every input node exactly once', () => {
    const nodes = [node('root', null), node('a', 'root'), node('b', 'a'), node('c', 'root')]
    const seen: string[] = []
    const walk = (list: { id: string; children: { id: string; children: unknown[] }[] }[]) => {
      for (const n of list) {
        seen.push(n.id)
        walk(n.children as never)
      }
    }
    walk(buildFolderTree(nodes) as never)
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'root'])
  })

  it('produces a serialisable forest from cyclic data', () => {
    // A tRPC response is `JSON.stringify`d; a self-referential structure throws
    // `TypeError: Converting circular structure to JSON` at that point, far from
    // the cause.
    const nodes = [node('a', 'b'), node('b', 'a'), node('c', null)]
    const tree = buildFolderTree(nodes)
    expect(() => JSON.stringify(tree)).not.toThrow()
    const ids = JSON.stringify(tree).match(/"id":"(\w+)"/g)
    expect(ids).toHaveLength(3)
  })

  it('keeps duplicate sibling names apart', () => {
    const nodes = [node('root', null), node('x', 'root', 'Docs'), node('y', 'root', 'Docs')]
    expect(buildFolderTree(nodes)[0]?.children.map((c) => c.name)).toEqual(['Docs', 'Docs'])
  })

  it('falls back to the root path for a null path column', () => {
    expect(buildFolderTree([node('a', null, 'A', { path: null })])[0]?.path).toBe(ROOT_PATH)
  })
})

describe('indexByParent', () => {
  it('buckets roots under null and preserves input order', () => {
    const nodes = [node('a', null), node('b', 'a'), node('c', 'a'), node('d', null)]
    const index = indexByParent(nodes)
    expect(index.get(null)?.map((n) => n.id)).toEqual(['a', 'd'])
    expect(index.get('a')?.map((n) => n.id)).toEqual(['b', 'c'])
  })
})

// ============= Property-style: invariants over generated forests =============

/** Deterministic PRNG, so a failure is reproducible from the seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random acyclic forest: a node's parent is always an earlier node or null. */
function randomForest(seed: number, size: number): FolderNode[] {
  const random = mulberry32(seed)
  const names = ['Docs', 'Docs', 'Rechnungen', '発注書', '100% off', 'a_b', 'x y']
  const nodes: FolderNode[] = []
  for (let i = 0; i < size; i++) {
    const parentIndex = Math.floor(random() * (i + 1)) - 1
    nodes.push(
      node(
        `n${i}`,
        parentIndex >= 0 ? `n${parentIndex}` : null,
        names[Math.floor(random() * names.length)] as string,
        { path: '/stale', depth: -1 }
      )
    )
  }
  return nodes
}

const SEEDS = [1, 7, 42, 1337, 90210]

describe('property: computeTreeShape agrees with the walks it is built from', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const nodes = randomForest(seed, 120)
    const index = indexById(nodes)
    for (const shape of computeTreeShape(nodes)) {
      const chainToNode = ancestorsOf(index, shape.id)
      expect(shape.depth).toBe(chainToNode.length)
      expect(shape.path).toBe(computePath(chainToNode, index.get(shape.id)?.name as string))
    }
  })
})

describe('property: cycle detection matches the descendant set exactly', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const nodes = randomForest(seed, 80)
    for (const subject of nodes) {
      const descendants = new Set(descendantsOf(nodes, subject.id).map((n) => n.id))
      for (const target of nodes) {
        // Moving `subject` under `target` closes a loop exactly when `target` is
        // `subject` itself or sits inside `subject`'s own subtree.
        const expected = target.id === subject.id || descendants.has(target.id)
        expect(wouldCreateCycle(nodes, subject.id, target.id)).toBe(expected)
      }
      expect(wouldCreateCycle(nodes, subject.id, null)).toBe(false)
    }
  })
})

describe('property: buildFolderTree is a partition of its input', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const nodes = randomForest(seed, 150)
    const tree = buildFolderTree(nodes)

    const seen = new Set<string>()
    const stack = [...tree]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      expect(seen.has(current.id)).toBe(false)
      seen.add(current.id)
      stack.push(...current.children)
    }

    expect(seen.size).toBe(nodes.length)
    expect(() => JSON.stringify(tree)).not.toThrow()
  })
})

describe('property: ancestor and descendant walks are inverses', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const nodes = randomForest(seed, 90)
    const index = indexById(nodes)
    for (const subject of nodes) {
      for (const descendant of descendantsOf(nodes, subject.id)) {
        expect(ancestorsOf(index, descendant.id).map((n) => n.id)).toContain(subject.id)
        expect(isAncestorOf(nodes, subject.id, descendant.id)).toBe(true)
      }
    }
  })
})
