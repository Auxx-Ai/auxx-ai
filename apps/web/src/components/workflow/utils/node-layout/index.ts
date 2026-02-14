// apps/web/src/components/workflow/utils/node-layout/index.ts

export { CollisionDetector, type NodeBounds, type Point, type Size } from './collision-detector'
export { type EdgeChange, type EdgeCreationParams, EdgeManager } from './edge-manager'
export {
  applyLaneShifts,
  buildHandleLanes,
  checkLaneShiftRequired,
  computeHandleBaseY,
  findLaneForHandle,
  getHandleOrder,
  type HandleLane,
  isMultiHandleNode,
  type LaneShiftConfig,
} from './handle-lanes'
export { type CreateNodeParams, NodeFactory } from './node-factory'
export { type Direction, NodeMover, type ShiftResult } from './node-mover'
export {
  PositionCalculator,
  type PositionContext,
  type PositionResult,
} from './position-calculator'
