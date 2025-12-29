// apps/web/src/components/workflow/nodes/core/note/constants.ts

import type { NoteTheme } from './types'

export const THEME_MAP: Record<
  NoteTheme,
  { bg: string; border: string; title: string; text: string }
> = {
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/50',
    border: 'border-yellow-400 dark:border-yellow-600',
    title: 'bg-yellow-400',
    text: 'text-yellow-600 dark:text-yellow-400',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-900/50',
    border: 'border-blue-400 dark:border-blue-600',
    title: 'bg-blue-400',
    text: 'text-blue-600 dark:text-blue-400',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-900/50',
    border: 'border-purple-400 dark:border-purple-600',
    title: 'bg-purple-400',
    text: 'text-purple-600 dark:text-purple-300',
  },
  pink: {
    bg: 'bg-pink-50 dark:bg-pink-900/50',
    border: 'border-pink-400 dark:border-pink-600',
    title: 'bg-pink-400',
    text: 'text-pink-600 dark:text-pink-400',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-900/50',
    border: 'border-green-400 dark:border-green-600',
    title: 'bg-green-400',
    text: 'text-green-600 dark:text-green-400',
  },
}

export const DEFAULT_NOTE_WIDTH = 280
export const DEFAULT_NOTE_HEIGHT = 200
export const MIN_NOTE_WIDTH = 240
export const MIN_NOTE_HEIGHT = 88
