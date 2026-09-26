// packages/lib/src/sidebar-layout/__tests__/plan.test.ts

import { describe, expect, it } from 'vitest'
import { FAVORITES_CAP } from '../../favorites/client'
import { countFavoriteBudget } from '../constants'
import { createLayoutDraft, draftRows, type LayoutDraft } from '../draft'
import {
  type LayoutEnv,
  materializeDraft,
  planCreateFolder,
  planCreateGroup,
  planDeleteNode,
  planMoveNode,
  planRenameNode,
  planResetLayout,
  planSetHidden,
} from '../plan'
import { resolveSidebarLayout } from '../resolve'
import type { SidebarNodeEntity } from '../types'
import { favorite, folder, MEMBER, NAV_IDS, outline, RESOURCES } from './support/fixtures'

const ENV: LayoutEnv = { snapshot: null, resources: RESOURCES, navIds: NAV_IDS }

const draftOf = (rows: SidebarNodeEntity[]) => createLayoutDraft(MEMBER, rows)
const view = (draft: LayoutDraft) =>
  outline(resolveSidebarLayout({ nodes: draftRows(draft), ...ENV }))
const find = (draft: LayoutDraft, pred: (r: SidebarNodeEntity) => boolean) =>
  draftRows(draft).find(pred)!
const navRow = (draft: LayoutDraft, navId: string) =>
  find(draft, (r) => r.targetType === 'NAV' && r.targetIds?.navId === navId)
const groupRow = (draft: LayoutDraft, systemKey: string) =>
  find(draft, (r) => r.nodeType === 'GROUP' && r.systemKey === systemKey)

/** A draft that went through materialization, with its ops cleared. */
function materialized(rows: SidebarNodeEntity[] = []): LayoutDraft {
  const draft = draftOf(rows)
  materializeDraft(draft, ENV)
  return draftOf(draftRows(draft))
}

describe('materializeDraft', () => {
  it('writes the resolved default as rows, identical to what the member saw', () => {
    const rows = [folder('fold', 'a0'), favorite('f1', 'a0', 'fold'), favorite('f2', 'a1')]
    const before = outline(resolveSidebarLayout({ nodes: rows, ...ENV }))
    const draft = draftOf(rows)
    materializeDraft(draft, ENV)
    expect(view(draft)).toEqual(before)

    const types = draftRows(draft).map((r) => r.nodeType)
    expect(types.filter((t) => t === 'GROUP')).toHaveLength(3)
    // Hidden-by-default defs are materialized hidden; 'never' defs are not materialized.
    const parcel = find(draft, (r) => r.targetIds?.entityDefinitionId === 'def_parcel')
    expect(parcel.isHidden).toBe(true)
    expect(draftRows(draft).some((r) => r.targetIds?.entityDefinitionId === 'def_line')).toBe(false)
  })

  it('re-parents root favorites and favorite folders under the Favorites group', () => {
    const draft = draftOf([
      folder('fold', 'a0'),
      favorite('f1', 'a0', 'fold'),
      favorite('f2', 'a1'),
    ])
    materializeDraft(draft, ENV)
    const favGroup = groupRow(draft, 'favorites')
    expect(draft.rows.get('fold')!.parentId).toBe(favGroup.id)
    expect(draft.rows.get('f2')!.parentId).toBe(favGroup.id)
    // Folder contents are untouched.
    expect(draft.rows.get('f1')!.parentId).toBe('fold')
  })

  it('records snapshot folder and custom group refs in draft.refs for queued client calls', () => {
    const env: LayoutEnv = {
      ...ENV,
      snapshot: {
        version: 1,
        groups: [
          {
            key: 'ops',
            title: 'Ops',
            children: [{ type: 'FOLDER', key: 'k1', title: 'Dispatch', children: [] }],
          },
        ],
      },
    }
    const draft = draftOf([])
    planSetHidden(draft, env, { nodeId: 'nav:agents', isHidden: true })
    const folderId = draft.refs.get('folder:k1')
    const groupId = draft.refs.get('group:ops')
    expect(draft.rows.get(folderId!)?.nodeType).toBe('FOLDER')
    expect(draft.rows.get(groupId!)?.nodeType).toBe('GROUP')

    // A later request can't resolve the virtual refs, only the mapped row ids.
    const next = draftOf(draftRows(draft))
    expect(planRenameNode(next, env, { nodeId: 'folder:k1', title: 'X' }).isErr()).toBe(true)
    expect(planRenameNode(next, env, { nodeId: folderId!, title: 'X' }).isOk()).toBe(true)
  })

  it('is idempotent', () => {
    const draft = materialized([favorite('f1', 'a0')])
    const keyMap = materializeDraft(draft, ENV)
    expect(keyMap.size).toBe(0)
    expect(draft.ops).toEqual([])
  })
})

describe('planMoveNode', () => {
  it('writes exactly one row on a materialized layout', () => {
    const draft = materialized()
    const workspace = groupRow(draft, 'workspace')
    const agents = navRow(draft, 'agents')
    const workflows = navRow(draft, 'workflows')

    const result = planMoveNode(draft, ENV, {
      nodeId: workflows.id,
      parentId: workspace.id,
      afterId: agents.id,
    })
    expect(result.isOk()).toBe(true)
    expect(draft.ops).toHaveLength(1)
    expect(draft.ops[0]).toMatchObject({ type: 'update', id: workflows.id })
    expect(view(draft).Workspace).toEqual(['nav:workflows', 'nav:agents', 'nav:dispatch'])
  })

  it('places after `beforeId` across rows the client did not render', () => {
    const draft = materialized()
    const workspace = groupRow(draft, 'workspace')
    const agents = navRow(draft, 'agents')
    const workflows = navRow(draft, 'workflows')
    planMoveNode(draft, ENV, { nodeId: workflows.id, parentId: workspace.id, beforeId: agents.id })
    expect(view(draft).Workspace).toEqual(['nav:agents', 'nav:workflows', 'nav:dispatch'])
  })

  it('materializes first when the member has no layout, resolving virtual refs', () => {
    const draft = draftOf([])
    const result = planMoveNode(draft, ENV, {
      nodeId: 'entity:def_contact',
      parentId: 'group:workspace',
      beforeId: 'nav:agents',
    })
    expect(result.isOk()).toBe(true)
    expect(view(draft).Workspace).toEqual([
      'nav:agents',
      'entity:def_contact',
      'nav:dispatch',
      'nav:workflows',
    ])
  })

  it('reorders favorites without materializing', () => {
    const draft = draftOf([favorite('f1', 'a0'), favorite('f2', 'a1')])
    const result = planMoveNode(draft, ENV, {
      nodeId: 'f2',
      parentId: 'group:favorites',
      afterId: 'f1',
    })
    expect(result.isOk()).toBe(true)
    expect(draft.ops).toHaveLength(1)
    expect(draft.rows.get('f2')!.parentId).toBeNull()
    expect(draftRows(draft).some((r) => r.nodeType === 'GROUP')).toBe(false)
  })

  it('creates a row for an unplaced def when a customized member moves it', () => {
    const draft = materialized()
    const records = groupRow(draft, 'records')
    // A def created after materialization has no row yet.
    const env: LayoutEnv = { ...ENV, resources: [...RESOURCES, { id: 'def_new', sidebar: 'on' }] }
    const result = planMoveNode(draft, env, { nodeId: 'entity:def_new', parentId: records.id })
    expect(result.isOk()).toBe(true)
    expect(draft.ops.map((o) => o.type)).toEqual(['insert', 'update'])
  })

  describe('depth rules', () => {
    it('groups only reorder among groups', () => {
      const draft = materialized()
      const records = groupRow(draft, 'records')
      const r = planMoveNode(draft, ENV, {
        nodeId: records.id,
        parentId: groupRow(draft, 'workspace').id,
      })
      expect(r.isErr() && r.error.message).toBe('Groups only reorder among groups')
      const ok = planMoveNode(draft, ENV, { nodeId: records.id, parentId: null })
      expect(ok.isOk()).toBe(true)
    })

    it('folders cannot nest', () => {
      const draft = materialized([folder('a', 'a0'), folder('b', 'a1')])
      const r = planMoveNode(draft, ENV, { nodeId: 'a', parentId: 'b' })
      expect(r.isErr() && r.error.message).toBe('Folders cannot be nested')
    })

    it('only groups sit at the top level', () => {
      const draft = materialized()
      const r = planMoveNode(draft, ENV, { nodeId: navRow(draft, 'agents').id, parentId: null })
      expect(r.isErr() && r.error.message).toBe('Only groups can sit at the top level')
    })

    it('items cannot contain nodes', () => {
      const draft = materialized()
      const r = planMoveNode(draft, ENV, {
        nodeId: navRow(draft, 'agents').id,
        parentId: navRow(draft, 'dispatch').id,
      })
      expect(r.isErr() && r.error.message).toBe('Items cannot contain nodes')
    })

    it('an item may go into a folder outside Favorites', () => {
      const draft = materialized([folder('fold', 'a0')])
      planMoveNode(draft, ENV, { nodeId: 'fold', parentId: groupRow(draft, 'records').id })
      const r = planMoveNode(draft, ENV, { nodeId: navRow(draft, 'agents').id, parentId: 'fold' })
      expect(r.isOk()).toBe(true)
      expect(navRow(draft, 'agents').parentId).toBe('fold')
    })
  })

  describe('favorites-only rule', () => {
    it('keeps nav and record items out of the Favorites group and its folders', () => {
      const draft = materialized([folder('fold', 'a0')])
      const intoGroup = planMoveNode(draft, ENV, {
        nodeId: navRow(draft, 'agents').id,
        parentId: groupRow(draft, 'favorites').id,
      })
      expect(intoGroup.isErr() && intoGroup.error.message).toBe(
        'Only favorites can go in Favorites'
      )
      const intoFolder = planMoveNode(draft, ENV, {
        nodeId: navRow(draft, 'agents').id,
        parentId: 'fold',
      })
      expect(intoFolder.isErr()).toBe(true)
    })

    it('lets a folder into Favorites only while it holds nothing but favorites', () => {
      const draft = materialized([folder('fold', 'a0'), favorite('f1', 'a0', 'fold')])
      const records = groupRow(draft, 'records').id
      const favorites = groupRow(draft, 'favorites').id
      expect(planMoveNode(draft, ENV, { nodeId: 'fold', parentId: records }).isOk()).toBe(true)
      expect(planMoveNode(draft, ENV, { nodeId: 'fold', parentId: favorites }).isOk()).toBe(true)

      planMoveNode(draft, ENV, { nodeId: 'fold', parentId: records })
      planMoveNode(draft, ENV, { nodeId: navRow(draft, 'agents').id, parentId: 'fold' })
      const r = planMoveNode(draft, ENV, { nodeId: 'fold', parentId: favorites })
      expect(r.isErr()).toBe(true)
    })

    it('still lets favorites leave Favorites', () => {
      const draft = materialized([favorite('f2', 'a1')])
      const r = planMoveNode(draft, ENV, {
        nodeId: 'f2',
        parentId: groupRow(draft, 'workspace').id,
      })
      expect(r.isOk()).toBe(true)
    })

    it('rejects a neighbour that is not a sibling', () => {
      const draft = materialized()
      const r = planMoveNode(draft, ENV, {
        nodeId: navRow(draft, 'agents').id,
        parentId: groupRow(draft, 'records').id,
        beforeId: navRow(draft, 'dispatch').id,
      })
      expect(r.isErr()).toBe(true)
    })
  })
})

describe('planDeleteNode', () => {
  it('re-homes a folder’s items into the folder’s group instead of deleting them', () => {
    const draft = materialized([folder('fold', 'a0'), favorite('f1', 'a0', 'fold')])
    const workspace = groupRow(draft, 'workspace')
    planMoveNode(draft, ENV, { nodeId: 'fold', parentId: workspace.id })
    planMoveNode(draft, ENV, { nodeId: navRow(draft, 'agents').id, parentId: 'fold' })

    expect(planDeleteNode(draft, ENV, { nodeId: 'fold' }).isOk()).toBe(true)
    expect(draft.rows.has('fold')).toBe(false)
    expect(draft.rows.get('f1')!.parentId).toBe(workspace.id)
    expect(navRow(draft, 'agents').parentId).toBe(workspace.id)
  })

  it('re-homes a favorites folder at the root for an un-customized member, without materializing', () => {
    const draft = draftOf([
      folder('fold', 'a0'),
      favorite('f1', 'a0', 'fold'),
      favorite('f2', 'a1'),
    ])
    expect(planDeleteNode(draft, ENV, { nodeId: 'fold' }).isOk()).toBe(true)
    expect(draft.rows.get('f1')!.parentId).toBeNull()
    expect(draftRows(draft).some((r) => r.nodeType === 'GROUP')).toBe(false)
    expect(view(draft).Favorites).toEqual(['fav:wf_f2', 'fav:wf_f1'])
  })

  it('sends a custom group’s contents home by type and dissolves its folders', () => {
    const draft = materialized([favorite('f1', 'a0')])
    const created = planCreateGroup(draft, ENV, { title: 'Mine' })
    const groupId = created._unsafeUnwrap()!
    planCreateFolder(draft, ENV, { parentId: groupId, title: 'Inner' })
    const inner = find(draft, (r) => r.title === 'Inner')
    planMoveNode(draft, ENV, { nodeId: navRow(draft, 'agents').id, parentId: groupId })
    planMoveNode(draft, ENV, { nodeId: 'f1', parentId: inner.id })
    const contact = find(draft, (r) => r.targetIds?.entityDefinitionId === 'def_contact')
    planMoveNode(draft, ENV, { nodeId: contact.id, parentId: inner.id })

    expect(planDeleteNode(draft, ENV, { nodeId: groupId }).isOk()).toBe(true)
    const v = view(draft)
    expect(v.Mine).toBeUndefined()
    expect(v.Workspace).toEqual(['nav:dispatch', 'nav:workflows', 'nav:agents'])
    expect(v.Favorites).toEqual(['fav:wf_f1'])
    expect(v.Records).toEqual(['entity:def_parcel(hidden)', 'entity:def_contact'])
  })

  it('refuses to delete a system group or a nav item', () => {
    const draft = materialized()
    const g = planDeleteNode(draft, ENV, { nodeId: groupRow(draft, 'records').id })
    expect(g.isErr()).toBe(true)
    const n = planDeleteNode(draft, ENV, { nodeId: navRow(draft, 'agents').id })
    expect(n.isErr()).toBe(true)
  })
})

describe('other planners', () => {
  it('hides a virtual node by materializing then flagging its row', () => {
    const draft = draftOf([])
    expect(planSetHidden(draft, ENV, { nodeId: 'nav:dispatch', isHidden: true }).isOk()).toBe(true)
    expect(navRow(draft, 'dispatch').isHidden).toBe(true)
  })

  it('renames a system group', () => {
    const draft = materialized()
    planRenameNode(draft, ENV, { nodeId: 'group:records', title: 'Data' })
    expect(groupRow(draft, 'records').title).toBe('Data')
  })

  it('creates a Favorites folder at the root without materializing', () => {
    const draft = draftOf([])
    const r = planCreateFolder(draft, ENV, { parentId: 'group:favorites', title: 'Later' })
    expect(r.isOk()).toBe(true)
    expect(draft.ops).toHaveLength(1)
    expect(find(draft, (x) => x.title === 'Later').parentId).toBeNull()
  })
})

describe('FAVORITES_CAP budget', () => {
  it('counts favorite items and folders, never groups, nav or record rows', () => {
    const draft = materialized([folder('fold', 'a0'), favorite('f1', 'a0', 'fold')])
    // 3 groups + 3 nav + 2 defs + the folder + the favorite.
    expect(draftRows(draft)).toHaveLength(10)
    expect(countFavoriteBudget(draftRows(draft))).toBe(2)
  })

  it('refuses a folder once the cap is reached', () => {
    const rows = Array.from({ length: FAVORITES_CAP }, (_, i) =>
      favorite(`f${i}`, `a${String(i).padStart(2, '0')}`)
    )
    const r = planCreateFolder(draftOf(rows), ENV, { parentId: 'group:favorites', title: 'X' })
    expect(r.isErr()).toBe(true)
  })
})

describe('planResetLayout', () => {
  it('drops layout rows and returns favorites and favorites-holding folders to the root', () => {
    const draft = materialized([
      folder('fold', 'a0'),
      favorite('f1', 'a0', 'fold'),
      favorite('f2', 'a1'),
    ])
    planCreateGroup(draft, ENV, { title: 'Mine' })
    const mine = find(draft, (r) => r.title === 'Mine')
    planCreateFolder(draft, ENV, { parentId: mine.id, title: 'NavOnly' })
    const navOnly = find(draft, (r) => r.title === 'NavOnly')
    planMoveNode(draft, ENV, { nodeId: navRow(draft, 'agents').id, parentId: navOnly.id })
    planMoveNode(draft, ENV, { nodeId: navRow(draft, 'dispatch').id, parentId: 'fold' })
    planMoveNode(draft, ENV, { nodeId: 'f2', parentId: mine.id })

    const reset = draftOf(draftRows(draft))
    expect(planResetLayout(reset, ENV).isOk()).toBe(true)
    const rows = draftRows(reset)
    expect(rows.map((r) => r.id).sort()).toEqual(['f1', 'f2', 'fold'])
    expect(reset.rows.get('fold')!.parentId).toBeNull()
    expect(reset.rows.get('f1')!.parentId).toBe('fold')
    expect(reset.rows.get('f2')!.parentId).toBeNull()
    expect(view(reset).Favorites).toEqual(['folder:fold', '  fav:wf_f1', 'fav:wf_f2'])
  })
})
