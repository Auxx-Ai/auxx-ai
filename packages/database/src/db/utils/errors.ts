// packages/database/src/db/utils/errors.ts
// Minimal error types local to @auxx/database to avoid cross-package cycles

import { DrizzleError } from 'drizzle-orm'
import { DatabaseError } from 'pg'

/**
 * Custom error class for not found errors
 */
export class NotFoundError extends Error {
  public statusCode = 404
  constructor(message: string = 'Not Found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * PostgreSQL error codes
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PostgresErrorCodes = {
  // Class 23 - Integrity Constraint Violation
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  notNullViolation: '23502',
  checkViolation: '23514',

  // Class 22 - Data Exception
  invalidTextRepresentation: '22P02',
  dataException: '22000',

  // Class 42 - Syntax Error or Access Rule Violation
  datatypeMismatch: '42804',
  undefinedColumn: '42703',
  syntaxError: '42601',
  undefinedTable: '42P01',

  // Class 25 - Invalid Transaction State
  invalidTransactionState: '25000',

  // Class 08 - Connection Exception
  connectionException: '08006',

  // Class 40 - Transaction Rollback
  serializationFailure: '40001',

  // Lock Not Available
  lockNotAvailable: '55P03',

  // Enum related
  unsafeNewEnumValueUsage: '55P04',
} as const

/**
 * Database error message with optional constraint information
 */
export interface DbErrorMessage {
  message: string
  constraint: string | null
  code?: string
}

/**
 * Error handler function type
 */
type ErrorHandler = (error: DatabaseError) => DbErrorMessage

/**
 * Maps PostgreSQL error codes to specific handler functions
 */
const PostgresErrorHandlers: Record<string, ErrorHandler> = {
  // Unique constraint violation (e.g., duplicate email)
  [PostgresErrorCodes.uniqueViolation]: (error) => ({
    message: 'A duplicate entry was found for a unique field.',
    constraint: error.constraint || null,
    code: error.code,
  }),

  // Foreign key violation (e.g., referenced record doesn't exist)
  [PostgresErrorCodes.foreignKeyViolation]: (error) => ({
    message: 'A foreign key violation occurred. The record you are trying to link does not exist.',
    constraint: error.constraint || null,
    code: error.code,
  }),

  // Not null violation (e.g., required field is missing)
  [PostgresErrorCodes.notNullViolation]: (error) => ({
    message: `A required field is missing. The column '${error.column || 'unknown'}' cannot be null.`,
    constraint: error.column || null,
    code: error.code,
  }),

  // Check constraint violation (e.g., value doesn't meet constraint)
  [PostgresErrorCodes.checkViolation]: (error) => ({
    message: 'A check constraint was violated.',
    constraint: error.constraint || null,
    code: error.code,
  }),

  // Invalid text representation (e.g., not a valid UUID, invalid enum value)
  [PostgresErrorCodes.invalidTextRepresentation]: (error) => {
    // Check if this is an enum violation
    if (error.message?.includes('invalid input value for enum')) {
      const enumMatch = error.message.match(/invalid input value for enum "?(\w+)"?: "?([^"]+)"?/)
      if (enumMatch) {
        const [, enumType, invalidValue] = enumMatch
        return {
          message: `Invalid ${enumType} value: "${invalidValue}". Please use a valid enum value.`,
          constraint: enumType || null,
          code: error.code || undefined,
        }
      }
      return {
        message: 'An invalid enum value was provided.',
        constraint: null,
        code: error.code || undefined,
      }
    }

    // Generic invalid text representation (e.g., UUID format)
    return {
      message: 'The data provided is in an invalid format (e.g., not a valid UUID or enum value).',
      constraint: null,
      code: error.code || undefined,
    }
  },

  // Data exception
  [PostgresErrorCodes.dataException]: (error) => ({
    message: `A data exception occurred: ${error.message || 'Invalid data provided'}`,
    constraint: null,
    code: error.code,
  }),

  // Datatype mismatch
  [PostgresErrorCodes.datatypeMismatch]: (error) => ({
    message: `Data type mismatch: ${error.message || 'The value type does not match the column type'}`,
    constraint: null,
    code: error.code,
  }),

  // Undefined column
  [PostgresErrorCodes.undefinedColumn]: (error) => ({
    message: 'An undefined column was referenced in the query.',
    constraint: error.column || null,
    code: error.code,
  }),

  // Syntax error
  [PostgresErrorCodes.syntaxError]: (error) => ({
    message: "There's a syntax error in the database query.",
    constraint: null,
    code: error.code,
  }),

  // Undefined table
  [PostgresErrorCodes.undefinedTable]: (error) => ({
    message: 'A referenced table does not exist in the database.',
    constraint: null,
    code: error.code,
  }),

  // Invalid transaction state
  [PostgresErrorCodes.invalidTransactionState]: (error) => ({
    message:
      'Transaction failed: a data integrity issue occurred within a database transaction.',
    constraint: null,
    code: error.code,
  }),

  // Connection exception
  [PostgresErrorCodes.connectionException]: (error) => ({
    message: 'Database connection failed. The database may be unavailable.',
    constraint: null,
    code: error.code,
  }),

  // Serialization failure
  [PostgresErrorCodes.serializationFailure]: (error) => ({
    message:
      'Transaction serialization failure. Please retry the transaction as it could not be completed due to concurrent modifications.',
    constraint: null,
    code: error.code,
  }),

  // Lock not available
  [PostgresErrorCodes.lockNotAvailable]: (error) => ({
    message: 'Could not obtain a lock on the requested resource. The resource may be in use.',
    constraint: null,
    code: error.code,
  }),

  // Default handler for unhandled error codes
  default: (error) => ({
    message: `A database error occurred: ${error.message}`,
    constraint: null,
    code: error.code,
  }),
}

/**
 * Extracts a user-friendly message and constraint from a Drizzle ORM error.
 *
 * @param error - The error object from Drizzle or PostgreSQL
 * @returns An object with the main error message, constraint name (if applicable), and error code
 *
 * @example
 * ```typescript
 * try {
 *   await db.insert(schema.User).values({ email: 'duplicate@example.com' })
 * } catch (error) {
 *   const { message, constraint, code } = getDbErrorMessage(error)
 *   console.log(message) // "A duplicate entry was found for a unique field."
 *   console.log(constraint) // "User_email_key"
 *   console.log(code) // "23505"
 * }
 * ```
 *
 * @example
 * ```typescript
 * try {
 *   await db.insert(schema.Ticket).values({ type: 'SUPPORT' })
 * } catch (error) {
 *   const { message, constraint } = getDbErrorMessage(error)
 *   console.log(message) // "Invalid TicketType value: "SUPPORT". Please use a valid enum value."
 * }
 * ```
 */
export function getDbErrorMessage(error: unknown): DbErrorMessage {
  // Handle Drizzle errors that wrap PostgreSQL DatabaseError
  if (error instanceof DrizzleError && error.cause instanceof DatabaseError) {
    const originalError = error.cause
    const handler = PostgresErrorHandlers[originalError.code ?? 'default'] ?? PostgresErrorHandlers.default!

    return handler(originalError)
  }

  // Handle direct PostgreSQL DatabaseError
  if (error instanceof DatabaseError) {
    const handler = PostgresErrorHandlers[error.code ?? 'default'] ?? PostgresErrorHandlers.default!
    return handler(error)
  }

  // Handle generic Drizzle errors
  if (error instanceof DrizzleError) {
    return {
      message: error.message || 'A database error occurred.',
      constraint: null,
    }
  }

  // Handle generic Error instances
  if (error instanceof Error) {
    return {
      message: error.message || 'An unexpected error occurred.',
      constraint: null,
    }
  }

  // Final fallback for unknown error types
  return {
    message: 'An unknown error occurred.',
    constraint: null,
  }
}
