// apps/web/src/components/global/sidebar/tree/use-sidebar-mutations.ts
'use client'

import type { ResolvedSidebarLayout, SidebarMutationResult } from '@auxx/lib/sidebar-layout/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import type { SidebarMoveArgs } from './sidebar-drop-rules'
import { useSidebarNodesApi } from './sidebar-nodes-provider'
import { type SidebarNodesStoreApi, selectSidebarLayout } from './sidebar-nodes-store'
import {
  addFolderInLayout,
  addGroupInLayout,
  moveInLayout,
  removeFromLayout,
  renameInLayout,
  setHiddenInLayout,
} from './splice-layout'

type Position = { beforeId?: string; afterId?: string }

/** Maps a virtual ref queued before materialization to the row id the server created for it. */
type Ref = <T extends string | null | undefined>(key: T) => T

interface Queue {
  tail: Promise<unknown>
  inFlight: number
  refs: Map<string, string>
}

/** Per-store serial queue: each write sees the rows the previous one produced (see 02-server-api.md). */
const queues = new WeakMap<SidebarNodesStoreApi, Queue>()

/** Layout mutations with optimistic splices, serialized per member, errors as toasts. */
export function useSidebarMutations() {
  const store = useSidebarNodesApi()
  const utils = api.useUtils()
  const { mutateAsync: move } = api.sidebar.move.useMutation()
  const { mutateAsync: setHidden } = api.sidebar.setHidden.useMutation()
  const { mutateAsync: createGroup } = api.sidebar.createGroup.useMutation()
  const { mutateAsync: createFolder } = api.sidebar.createFolder.useMutation()
  const { mutateAsync: rename } = api.sidebar.rename.useMutation()
  const { mutateAsync: remove } = api.sidebar.delete.useMutation()
  const { mutateAsync: reset } = api.sidebar.reset.useMutation()
  const { mutateAsync: saveOrgDefault } = api.sidebar.saveOrgDefault.useMutation()

  const run = useCallback(
    (
      errorTitle: string,
      call: (ref: Ref) => Promise<SidebarMutationResult>,
      optimistic?: (layout: ResolvedSidebarLayout) => ResolvedSidebarLayout
    ): Promise<SidebarMutationResult | null> => {
      const queue = queues.get(store) ?? { tail: Promise.resolve(), inFlight: 0, refs: new Map() }
      queues.set(store, queue)
      if (optimistic) {
        store.getState().setPendingLayout(optimistic(selectSidebarLayout(store.getState())))
      }
      queue.inFlight++
      const result = queue.tail.then(async () => {
        try {
          // Only remap to rows that still exist, so refs from before a reset fall back to materializing.
          const ref: Ref = (key) => {
            const id = key ? queue.refs.get(key) : undefined
            if (!id || !store.getState().nodes.some((n) => n.id === id)) return key
            return id as typeof key
          }
          const res = await call(ref)
          for (const [key, id] of Object.entries(res.refs)) queue.refs.set(key, id)
          store.getState().setNodes(res.nodes)
          utils.sidebar.list.setData(undefined, (old) => (old ? { ...old, nodes: res.nodes } : old))
          return res
        } catch (error) {
          toastError({
            title: errorTitle,
            description: error instanceof Error ? error.message : undefined,
          })
          void utils.sidebar.list.invalidate()
          return null
        } finally {
          // The optimistic tree covers every queued write; drop it once the last one settles.
          if (--queue.inFlight === 0) store.getState().setPendingLayout(null)
        }
      })
      queue.tail = result
      return result
    },
    [store, utils]
  )

  return useMemo(
    () => ({
      move: (args: SidebarMoveArgs) =>
        run(
          'Could not move item',
          (ref) =>
            move({
              nodeId: ref(args.nodeId),
              parentId: ref(args.parentId),
              beforeId: ref(args.beforeId),
              afterId: ref(args.afterId),
            }),
          (l) => moveInLayout(l, args)
        ),
      setHidden: (nodeId: string, isHidden: boolean) =>
        run(
          isHidden ? 'Could not hide item' : 'Could not show item',
          (ref) => setHidden({ nodeId: ref(nodeId), isHidden }),
          (l) => setHiddenInLayout(l, nodeId, isHidden)
        ),
      rename: (nodeId: string, title: string) =>
        run(
          'Could not rename',
          (ref) => rename({ nodeId: ref(nodeId), title }),
          (l) => renameInLayout(l, nodeId, title)
        ),
      remove: (nodeId: string) =>
        run(
          'Could not delete',
          (ref) => remove({ nodeId: ref(nodeId) }),
          (l) => removeFromLayout(l, nodeId)
        ),
      createGroup: (title: string, position: Position = {}) =>
        run(
          'Could not create group',
          (ref) =>
            createGroup({
              title,
              beforeId: ref(position.beforeId),
              afterId: ref(position.afterId),
            }),
          (l) => addGroupInLayout(l, `pending-group:${crypto.randomUUID()}`, title, position)
        ),
      createFolder: (parentId: string, title: string, position: Position = {}) =>
        run(
          'Could not create folder',
          (ref) =>
            createFolder({
              parentId: ref(parentId),
              title,
              beforeId: ref(position.beforeId),
              afterId: ref(position.afterId),
            }),
          (l) =>
            addFolderInLayout(l, parentId, `pending-folder:${crypto.randomUUID()}`, title, position)
        ),
      reset: () => run('Could not reset sidebar', () => reset()),
      saveOrgDefault: () => saveOrgDefault(),
    }),
    [run, move, setHidden, rename, remove, createGroup, createFolder, reset, saveOrgDefault]
  )
}

export type SidebarMutations = ReturnType<typeof useSidebarMutations>
