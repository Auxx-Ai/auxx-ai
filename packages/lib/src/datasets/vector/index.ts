// packages/lib/src/datasets/vector/index.ts

// Export factory and implementations
export { VectorDatabaseFactory } from './factory'
export { PostgreSQLVectorDB } from './postgresql'

// Re-export types from the types directory
export type * from '../types/vector.types'
export { VectorDatabase } from '../types/vector.types'
