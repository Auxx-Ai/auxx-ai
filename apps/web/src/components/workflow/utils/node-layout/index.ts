// apps/web/src/components/workflow/utils/node-layout/index.ts

export { CollisionDetector, type NodeBounds, type Point, type Size } from './collision-detector'
export { NodeFactory, type CreateNodeParams } from './node-factory'
export {
  PositionCalculator,
  type PositionContext,
  type PositionResult,
} from './position-calculator'
export { NodeMover, type Direction, type ShiftResult } from './node-mover'
export { EdgeManager, type EdgeCreationParams, type EdgeChange } from './edge-manager'
export {
  buildHandleLanes,
  findLaneForHandle,
  checkLaneShiftRequired,
  applyLaneShifts,
  isMultiHandleNode,
  getHandleOrder,
  computeHandleBaseY,
  type HandleLane,
  type LaneShiftConfig,
} from './handle-lanes'
