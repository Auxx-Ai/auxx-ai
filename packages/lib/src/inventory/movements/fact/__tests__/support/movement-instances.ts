// packages/lib/src/inventory/movements/fact/__tests__/support/movement-instances.ts
// Ids for mirror rows; the mirror's id has no foreign key any more, so any unique id will do.

import { randomUUID } from 'node:crypto'

/** `count` fresh movement ids. */
export function newMovementIds(count = 1): string[] {
  return Array.from({ length: count }, () => randomUUID())
}
