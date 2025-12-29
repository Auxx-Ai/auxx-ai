// packages/services/src/vendor-parts/index.ts

// Query operations
export {
  getVendorParts,
  getVendorPartById,
  getVendorPartByContactAndPart,
  checkVendorPartExists,
} from './vendor-part-queries'

// Mutation operations
export {
  insertVendorPart,
  insertVendorPartTx,
  updateVendorPart,
  deleteVendorPart,
  clearOtherPreferred,
} from './vendor-part-mutations'

// Types
export type {
  VendorPartContext,
  CreateVendorPartInput,
  UpdateVendorPartInput,
  ListVendorPartsInput,
} from './types'

// Errors
export type { VendorPartError, VendorPartNotFoundError, VendorPartAlreadyExistsError } from './errors'
