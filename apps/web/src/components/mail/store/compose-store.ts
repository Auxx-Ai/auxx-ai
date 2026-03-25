// apps/web/src/components/mail/store/compose-store.ts
'use client'

import { create } from 'zustand'
import type {
  DraftMessageType,
  EditorMode,
  EditorPresetValues,
  EditorThread,
  MessageType,
} from '../email-editor/types'

type DisplayMode = 'floating' | 'inline' | 'minimized'

export interface ComposeInstance {
  id: string
  mode: EditorMode
  thread?: EditorThread | null
  sourceMessage?: MessageType | null
  draft?: DraftMessageType | null
  presetValues?: EditorPresetValues
  displayMode: DisplayMode
  portalTargetId: string | null
  position: { x: number; y: number }
  zIndex: number
  subject: string
  pendingFocus: boolean
}

type OpenConfig = Omit<
  ComposeInstance,
  'id' | 'displayMode' | 'portalTargetId' | 'position' | 'zIndex' | 'subject' | 'pendingFocus'
> & {
  displayMode?: DisplayMode
  pendingFocus?: boolean
}

const MAX_INSTANCES = 3
const BASE_Z_INDEX = 101

interface ComposeStore {
  instances: ComposeInstance[]
  nextZIndex: number

  open: (config: OpenConfig) => string
  close: (id: string) => void
  minimize: (id: string) => void
  maximize: (id: string) => void
  bringToFront: (id: string) => void
  updatePosition: (id: string, position: { x: number; y: number }) => void
  updateSubject: (id: string, subject: string) => void
  dock: (id: string, portalTargetId: string) => void
  undock: (id: string) => void
  clearPendingFocus: (id: string) => void
  findByThread: (threadId: string) => ComposeInstance | undefined
  findByDraft: (draftId: string) => ComposeInstance | undefined
}

let idCounter = 0
function generateId(): string {
  return `compose-${Date.now()}-${++idCounter}`
}

export const useComposeStore = create<ComposeStore>((set, get) => ({
  instances: [],
  nextZIndex: BASE_Z_INDEX,

  open: (config) => {
    const state = get()
    const id = generateId()
    const displayMode = config.displayMode ?? 'floating'

    // Enforce max instances — close oldest minimized, or oldest overall
    let instances = [...state.instances]
    if (instances.length >= MAX_INSTANCES) {
      const minimized = instances.find((i) => i.displayMode === 'minimized')
      if (minimized) {
        instances = instances.filter((i) => i.id !== minimized.id)
      } else {
        instances = instances.slice(1)
      }
    }

    // Cascade position for floating editors
    const floatingCount = instances.filter((i) => i.displayMode === 'floating').length
    const position = { x: floatingCount * 20, y: 0 }

    const instance: ComposeInstance = {
      id,
      mode: config.mode,
      thread: config.thread,
      sourceMessage: config.sourceMessage,
      draft: config.draft,
      presetValues: config.presetValues,
      displayMode,
      portalTargetId: null,
      position,
      zIndex: state.nextZIndex,
      subject: config.draft?.subject || config.presetValues?.subject || '',
      pendingFocus: config.pendingFocus ?? false,
    }

    console.log('[ComposeStore] open', id, instance.displayMode, instance.mode)

    set({
      instances: [...instances, instance],
      nextZIndex: state.nextZIndex + 1,
    })

    return id
  },

  close: (id) => {
    console.log('[ComposeStore] close', id, new Error().stack?.split('\n').slice(1, 4).join(' | '))
    set((state) => ({
      instances: state.instances.filter((i) => i.id !== id),
    }))
  },

  minimize: (id) => {
    set((state) => ({
      instances: state.instances.map((i) =>
        i.id === id ? { ...i, displayMode: 'minimized' as const } : i
      ),
    }))
  },

  maximize: (id) => {
    const state = get()
    set({
      instances: state.instances.map((i) =>
        i.id === id ? { ...i, displayMode: 'floating' as const, zIndex: state.nextZIndex } : i
      ),
      nextZIndex: state.nextZIndex + 1,
    })
  },

  bringToFront: (id) => {
    const state = get()
    const instance = state.instances.find((i) => i.id === id)
    if (!instance || instance.zIndex === state.nextZIndex - 1) return
    set({
      instances: state.instances.map((i) => (i.id === id ? { ...i, zIndex: state.nextZIndex } : i)),
      nextZIndex: state.nextZIndex + 1,
    })
  },

  updatePosition: (id, position) => {
    set((state) => ({
      instances: state.instances.map((i) => (i.id === id ? { ...i, position } : i)),
    }))
  },

  updateSubject: (id, subject) => {
    set((state) => ({
      instances: state.instances.map((i) => (i.id === id ? { ...i, subject } : i)),
    }))
  },

  dock: (id, portalTargetId) => {
    set((state) => ({
      instances: state.instances.map((i) =>
        i.id === id ? { ...i, displayMode: 'inline' as const, portalTargetId } : i
      ),
    }))
  },

  undock: (id) => {
    const state = get()
    set({
      instances: state.instances.map((i) =>
        i.id === id
          ? {
              ...i,
              displayMode: 'floating' as const,
              portalTargetId: null,
              zIndex: state.nextZIndex,
            }
          : i
      ),
      nextZIndex: state.nextZIndex + 1,
    })
  },

  clearPendingFocus: (id) => {
    set((state) => ({
      instances: state.instances.map((i) => (i.id === id ? { ...i, pendingFocus: false } : i)),
    }))
  },

  findByThread: (threadId) => {
    return get().instances.find((i) => i.thread?.id === threadId)
  },

  findByDraft: (draftId) => {
    return get().instances.find((i) => i.draft?.id === draftId)
  },
}))
