// packages/lib/src/datasets/vector/index.ts

// Re-export types from the types directory
export type * from '../types/vector.types'
export { VectorDatabase } from '../types/vector.types'
// Export factory and implementations
export { VectorDatabaseFactory } from './factory'
export { PostgreSQLVectorDB } from './postgresql'
