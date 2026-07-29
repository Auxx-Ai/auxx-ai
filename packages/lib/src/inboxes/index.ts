// packages/lib/src/inboxes/index.ts

export {
  assertInboxFloorFeature,
  type BaselineFloorRow,
  floorFromBaselineRow,
  readInboxFloors,
  setInboxFloor,
} from './inbox-floor'
export { InboxService } from './inbox-service'
export type {
  CreateInboxInput,
  Inbox,
  InboxIntegration,
  InboxStatus,
  InboxWithIntegrations,
  UpdateInboxInput,
} from './types'
