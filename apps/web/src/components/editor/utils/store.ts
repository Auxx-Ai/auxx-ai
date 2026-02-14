import type { Range } from '@tiptap/core'
import { atom, createStore } from 'jotai'

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export const auxxEditorStore: any = createStore()

export const queryAtom = atom('')
export const rangeAtom = atom<Range | null>(null)
