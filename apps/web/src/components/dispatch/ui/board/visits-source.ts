// apps/web/src/components/dispatch/ui/board/visits-source.ts
//
// The visits `CalendarSourceDescriptor` (plan §3.4) — the shared entry point the future
// `/app/calendar` page will import to compose a "Visits" toggle row + `visitToEvent` mapping.
// This is NOT a forced indirection inside dispatch itself: the board keeps calling its own
// `dispatch.getBoard` hook directly (`use-board-data.ts`), because it needs
// workers/backlog/workOrders from the same query, which the `CalendarSource` contract
// deliberately doesn't model (plan §3.1). Dispatch's grid/renderEvent/popover wiring is
// untouched by this file.

import type { CalendarSourceDescriptor } from '~/components/calendar/core/types'

/** Visits source descriptor — sidebar 'kinds' group row for the future `/app/calendar` page. */
export const visitsSourceDescriptor: CalendarSourceDescriptor = {
  id: 'visits',
  label: 'Visits',
  group: 'kinds',
}

export { visitToEvent } from './utils'
