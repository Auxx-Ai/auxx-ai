import { createStore, atom } from 'jotai'
import type { Range } from '@tiptap/core'

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export const auxxEditorStore: any = createStore()

export const queryAtom = atom('')
export const rangeAtom = atom<Range | null>(null)
