import type { Range } from '@tiptap/core'
import { atom, createStore } from 'jotai'

export const auxxEditorStore: any = createStore()

export const queryAtom = atom('')
export const rangeAtom = atom<Range | null>(null)
