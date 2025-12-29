// apps/web/src/components/workflow/nodes/core/loop/constants.ts

export const LOOP_CONSTANTS = {
  DEFAULT_MAX_ITERATIONS: 100,
  ABSOLUTE_MAX_ITERATIONS: 1000,
  DEFAULT_ITERATOR_NAME: 'item',
} as const

export const LOOP_VARIABLES = {
  INDEX: 'loop.index',
  COUNT: 'loop.count',
  TOTAL: 'loop.total',
  ITEM: 'loop.item',
  IS_FIRST: 'loop.isFirst',
  IS_LAST: 'loop.isLast',
  RESULTS: 'loop.results',
} as const

export const LOOP_HANDLES = {
  LOOP_START: 'loop-start', // Source handle that connects to first node in loop body
  LOOP_BACK: 'loop-back', // Target handle where nodes inside loop connect to restart iteration
} as const
