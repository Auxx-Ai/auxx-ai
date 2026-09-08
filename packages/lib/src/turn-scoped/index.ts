// packages/lib/src/turn-scoped/index.ts
//
// Generic per-turn Redis primitives shared by every Kopilot builder surface
// (workflow graph, KB article, dashboard layout). SERVER-ONLY.
//
// Each domain keeps its own thin module that names its key, its TTL, its
// payload type and its realtime event, and owns its own revert. Only the
// mechanics live here. See `turn-slot.ts` / `turn-lock.ts` for the invariants
// and why they are load-bearing.

export {
  createTurnLock,
  type TurnLock,
  type TurnLockOptions,
  type TurnLockRecord,
} from './turn-lock'
export {
  createTurnSlot,
  type TurnScopedRecord,
  type TurnSlot,
  type TurnSlotOptions,
} from './turn-slot'
