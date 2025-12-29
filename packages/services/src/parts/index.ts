// packages/services/src/parts/index.ts

// Query operations
export {
  getAllParts,
  getPartById,
  checkSkuExists,
  getPartAttachments,
  getLeafParts,
  getParentPartIds,
} from './part-queries'

// Mutation operations
export {
  insertPart,
  insertPartTx,
  insertInventory,
  insertInventoryTx,
  updatePart,
  updatePartTx,
  updateInventory,
  updateInventoryTx,
  deletePart,
  deleteInventory,
  getPartWithInventory,
} from './part-mutations'

// Types
export type {
  PartContext,
  CreatePartInput,
  CreateInventoryInput,
  UpdatePartInput,
  UpdateInventoryInput,
  GetAllPartsInput,
  CheckSkuExistsInput,
} from './types'

// Errors
export type { PartError, PartNotFoundError, SkuAlreadyExistsError } from './errors'
