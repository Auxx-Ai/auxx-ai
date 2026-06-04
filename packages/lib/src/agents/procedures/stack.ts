// packages/lib/src/agents/procedures/stack.ts

import type { ProcedureFrame, ProcedureStack } from './types'

/**
 * Pure helpers over {@link ProcedureStack}. Every mutating op returns a NEW
 * object (immutable updates) so callers can persist/diff freely. The stack is
 * the v9 interrupt/return structure: selection pushes frame 0, a customer
 * digression or author `call` pushes, `finished`/`end` pops, `switch` replaces
 * the top, and `handoff` clears.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §5.
 */

/** Hard cap on stack depth, counting ALL frames (incl. local `call` frames). */
export const MAX_DEPTH = 4

export function emptyStack(): ProcedureStack {
  return { frames: [] }
}

/** The running frame (top = last element), or `null` for free-form persona mode. */
export function top(stack: ProcedureStack): ProcedureFrame | null {
  return stack.frames.length > 0 ? stack.frames[stack.frames.length - 1]! : null
}

export function depth(stack: ProcedureStack): number {
  return stack.frames.length
}

export function push(stack: ProcedureStack, frame: ProcedureFrame): ProcedureStack {
  return { frames: [...stack.frames, frame] }
}

/** Pop the top frame, returning the new stack and the removed frame (`null` if empty). */
export function pop(stack: ProcedureStack): {
  stack: ProcedureStack
  popped: ProcedureFrame | null
} {
  if (stack.frames.length === 0) return { stack, popped: null }
  const frames = stack.frames.slice(0, -1)
  return { stack: { frames }, popped: stack.frames[stack.frames.length - 1]! }
}

/** Replace the top frame (author `switch` — no return). Pushes onto an empty stack. */
export function replaceTop(stack: ProcedureStack, frame: ProcedureFrame): ProcedureStack {
  if (stack.frames.length === 0) return { frames: [frame] }
  return { frames: [...stack.frames.slice(0, -1), frame] }
}

/** Clear the whole stack (handoff to a human). */
export function clear(_stack: ProcedureStack): ProcedureStack {
  return { frames: [] }
}

/** True when the stack is at (or beyond) {@link MAX_DEPTH} — refuse further pushes. */
export function atDepthCap(stack: ProcedureStack): boolean {
  return stack.frames.length >= MAX_DEPTH
}
