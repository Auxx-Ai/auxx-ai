// packages/sdk/src/errors.ts

import { z } from 'zod'
import type { ApiError } from './api/api.js'

/**
 * Union type of all possible SDK errors
 */
export type AuxxError =
  | { code: 'UNKNOWN_ERROR'; error: unknown }
  | { code: 'FILE_SYSTEM_ERROR'; error: Error }
  | { code: 'NETWORK_ERROR'; error: Error }
  | { code: 'AUTHENTICATION_ERROR'; message: string }
  | { code: 'VALIDATION_ERROR'; message: string; issues?: z.ZodIssue[] }

type Error = {
  message: string
}
/**
 * Fetcher-specific error types
 */
export type FetcherError =
  | { code: 'UNAUTHORIZED'; error: Error }
  | { code: 'HTTP_ERROR'; status: number; statusText: string; body?: string; error?: Error }
  | { code: 'NETWORK_ERROR'; error: Error }
  | { code: 'PARSE_ERROR'; error: Error }
  | { code: 'VALIDATION_ERROR'; error: z.ZodError }
  | { code: 'INVALID_RESPONSE'; error: Error }
  | { code: 'CREATE_VERSION_ERROR'; error?: Error }

/**
 * CLI version loading error types
 */
export type CliVersionError =
  | { code: 'UNABLE_TO_FIND_PACKAGE_JSON'; path: string }
  | { code: 'UNABLE_TO_READ_PACKAGE_JSON'; error: unknown }
  | { code: 'UNABLE_TO_PARSE_PACKAGE_JSON'; error: unknown }
  | { code: 'ERROR_LOADING_PACKAGE_JSON'; error: unknown }
  | { code: 'INVALID_PACKAGE_JSON'; error: z.ZodError }
  | { code: 'NO_CLI_VERSION_FOUND' }

export type CliVersionResult = Result<string, CliVersionError>

export type AppSlugError =
  | { code: 'MALFORMED_PACKAGE_JSON'; error: z.ZodError }
  | { code: 'INVALID_JSON'; error: Error }
  | { code: 'FILE_SYSTEM_ERROR'; error: Error | z.ZodError }

export type UploadError =
  | {
      code: 'BUNDLE_UPLOAD_ERROR'
      uploadUrl: string
      status?: number
      statusText?: string
      error?: string
    }
  | { code: 'START_UPLOAD_ERROR'; error: Error }
  | { code: 'COMPLETE_BUNDLE_UPLOAD_ERROR'; error: Error }

export type CreateProjectError =
  | { code: 'DIRECTORY_ALREADY_EXISTS'; path: string }
  | { code: 'WRITE_ACCESS_DENIED'; path: string }
  | { code: 'FAILED_TO_CREATE_DIRECTORY'; path: string }
  | { code: 'FAILED_TO_COPY_FILE'; src: string; dest: string }
  | { code: 'FAILED_TO_LIST_FILES'; path: string }
  | { code: 'FAILED_TO_READ_FILE'; path: string }
  | { code: 'FAILED_TO_WRITE_FILE'; path: string }

export type DetermineOrganizationError =
  | ApiError
  | { code: 'NO_ORGANIZATION_FOUND'; organization_slug: string }
  | { code: 'NO_ORGANIZATIONS_FOUND' }

/**
 * Custom error class for SDK-specific errors
 */
export class AuxxSDKError extends Error {
  public readonly code: string

  constructor(error: AuxxError) {
    super(error.code)
    this.code = error.code
    this.name = 'AuxxSDKError'
  }
}

export const jsErrorSchema = z.object({
  text: z.string(),
  location: z
    .object({
      column: z.number(),
      file: z.string(),
      length: z.number(),
      line: z.number(),
      lineText: z.string(),
      additionalLines: z.array(z.string()).optional(),
      namespace: z.string(),
      suggestion: z.string(),
    })
    .optional(),
})

export type JsError = z.infer<typeof jsErrorSchema>
export const errorsAndWarningsSchema = z.object({
  errors: z.array(jsErrorSchema).optional().readonly(),
  warnings: z.array(jsErrorSchema).optional().readonly(),
})

// ============================================================================
// Fetchable/Result Types
// ============================================================================

export type CompleteState = 'complete'
export type ErroredState = 'error'
export type PendingState = 'pending'

export interface Pending {
  state: PendingState
}

export interface Errored<TError> {
  state: ErroredState
  error: TError
}

export interface Complete<TValue> {
  state: CompleteState
  value: TValue
}

export type Result<TValue, TError> = Errored<TError> | Complete<TValue>
export type AsyncResult<TValue, TError> = Promise<Result<TValue, TError>>
export type Loadable<TValue> = Pending | Complete<TValue>
export type Fetchable<TValue, TError = unknown> = Pending | Errored<TError> | Complete<TValue>

/**
 * Returns the error type of a fetchable
 */
export type ErrorOf<T> = T extends Errored<infer TError> ? TError : never

/**
 * Returns the complete type of a fetchable
 */
export type ValueOf<T> = T extends Complete<infer TValue> ? TValue : never

/**
 * Creates a new complete fetchable with the given value
 */
export function complete<TValue>(value: TValue): Complete<TValue> {
  return { state: 'complete', value }
}

/**
 * Creates a new errored fetchable with the given error
 */
export function errored<TError>(error: TError): Errored<TError> {
  return { state: 'error', error }
}

/**
 * Creates a new pending fetchable
 */
export function pending(): Pending {
  return { state: 'pending' }
}

/**
 * Type guard: Check if fetchable is complete
 */
export function isComplete<TFetchable extends Fetchable<any, any>>(
  fetchable: TFetchable
): fetchable is Extract<TFetchable, Complete<any>> {
  return fetchable.state === 'complete'
}

/**
 * Type guard: Check if fetchable is errored
 */
export function isErrored<TFetchable extends Fetchable<any, any>>(
  fetchable: TFetchable
): fetchable is Extract<TFetchable, Errored<any>> {
  return fetchable.state === 'error'
}

/**
 * Type guard: Check if fetchable is pending
 */
export function isPending<TFetchable extends Fetchable<any, any>>(
  fetchable: TFetchable
): fetchable is Extract<TFetchable, Pending> {
  return fetchable.state === 'pending'
}

/**
 * Turns a promise into a promise of a Result
 * If the promise resolves then a successful Result is returned
 * If the promise throws then an errored Result is returned
 */
export async function fromPromise<TValue, TError = unknown>(
  promise: Promise<TValue>
): AsyncResult<TValue, TError> {
  try {
    const value = await promise
    return complete(value)
  } catch (error) {
    return errored(error as TError)
  }
}

/**
 * Runs the given function and returns a result
 * If the function doesn't throw then a successful Result with its return value is returned
 * If the function throws then an errored Result with the thrown error is returned
 */
export function fromThrowable<TValue, TError = unknown>(
  func: () => TValue
): Result<TValue, TError> {
  try {
    return complete(func())
  } catch (error) {
    return errored(error as TError)
  }
}

/**
 * If the fetchable is complete then its value is transformed and returned wrapped in another
 * complete fetchable
 */
export function map<TFetchable extends Fetchable<any, any>, TMapped>(
  fetchable: TFetchable,
  func: (value: ValueOf<TFetchable>) => TMapped
): TFetchable extends Complete<any>
  ? Exclude<TFetchable, Complete<any>> | Complete<TMapped>
  : TFetchable {
  if (isComplete(fetchable)) {
    return complete(func(fetchable.value)) as any
  }
  return fetchable as any
}

/**
 * If the fetchable is errored then its error is transformed and returned wrapped in another
 * errored fetchable
 */
export function mapError<TFetchable extends Fetchable<any, any>, TMapped>(
  fetchable: TFetchable,
  func: (error: ErrorOf<TFetchable>) => TMapped
): TFetchable extends Errored<any>
  ? Exclude<TFetchable, Errored<any>> | Errored<TMapped>
  : TFetchable {
  if (isErrored(fetchable)) {
    return errored(func(fetchable.error)) as any
  }
  return fetchable as any
}

/**
 * If a complete fetchable is passed then its value is returned
 * Otherwise the fallback value is returned
 */
export function valueOrElse<TFetchable extends Fetchable<any, any>, TFallback>(
  fetchable: TFetchable,
  fallback: TFallback
): TFetchable extends Complete<infer TValue> ? TValue : TFallback {
  if (isComplete(fetchable)) {
    return fetchable.value as any
  }
  return fallback as any
}

/**
 * Combine multiple Results into a single Result with an array of values
 */
export function combine<T extends Result<any, any>[]>(
  results: T
): Result<{ [K in keyof T]: T[K] extends Result<infer V, any> ? V : never }, any> {
  for (const result of results) {
    if (isErrored(result)) {
      return result as any
    }
  }
  return complete(results.map((r: any) => r.value) as any)
}

/**
 * Combine multiple async Results from an array into a single Result with a tuple of values
 */
// export async function combineAsync<T extends readonly Promise<Result<any, any>>[]>(
//   promises: T
// ): Promise<Result<{ [K in keyof T]: T[K] extends Promise<Result<infer V, any>> ? V : never }, any>>

export async function combineAsync<
  T extends Array<Promise<Result<any, any>>> | Record<any, Promise<Result<any, any>>>,
>(
  promises: T
): Promise<
  Result<{ [K in keyof T]: T[K] extends Promise<Result<infer V, any>> ? V : never }, any>
> {
  if (Array.isArray(promises)) {
    return combineAsyncArray(promises)
  }
  return combineAsyncRecord(promises)
}

export async function combineAsyncRecord(
  promises: Record<any, Promise<Result<any, any>>>
): Promise<any> {
  return new Promise((resolve, reject) => {
    const entries = Object.entries(promises)
    if (entries.length === 0) {
      resolve(complete(promises))
      return
    }
    const values: Record<string, any> = {}
    let completed = 0
    const target = entries.length
    let hasSettled = false
    for (const [key, promise] of entries) {
      values[key] = undefined
      promise
        .then((result) => {
          if (isErrored(result)) {
            if (hasSettled) {
              return
            }
            hasSettled = true
            resolve(result)
            return
          }
          completed++
          values[key] = result.value
          if (completed === target && !hasSettled) {
            hasSettled = true
            resolve(complete(values))
          }
        })
        .catch((error) => {
          if (hasSettled) {
            return
          }
          hasSettled = true
          reject(error)
        })
    }
  })
}

export async function combineAsyncArray(promises: Array<Promise<Result<any, any>>>): Promise<any> {
  return new Promise((resolve, reject) => {
    const values: any[] = []
    if (promises.length === 0) {
      resolve(complete(values))
      return
    }
    let completed = 0
    const target = promises.length
    let hasSettled = false
    promises.forEach((promise, index) => {
      promise
        .then((result) => {
          if (isErrored(result)) {
            if (hasSettled) {
              return
            }
            hasSettled = true
            resolve(result)
            return
          }
          completed++
          values[index] = result.value
          if (completed === target && !hasSettled) {
            hasSettled = true
            resolve(complete(values))
          }
        })
        .catch((error) => {
          if (hasSettled) {
            return
          }
          hasSettled = true
          reject(error)
        })
    })
  })
}

/**
 * Combine multiple async Results from an object into a single Result with the same object shape
 */
// export async function combineAsync<T extends Record<string, Promise<Result<any, any>>>>(
//   obj: T
// ): Promise<Result<{ [K in keyof T]: T[K] extends Promise<Result<infer V, any>> ? V : never }, any>>

// /**
//  * Implementation: handles both arrays and objects
//  */
// export async function combineAsync(
//   input: readonly Promise<Result<any, any>>[] | Record<string, Promise<Result<any, any>>>
// ): Promise<Result<any, any>> {
//   // Handle array input
//   if (Array.isArray(input)) {
//     const results = await Promise.all(input)

//     for (const result of results) {
//       if (isErrored(result)) {
//         return result
//       }
//     }

//     return complete(results.map((r: any) => r.value))
//   }

//   // Handle object input
//   const entries = Object.entries(input)
//   const results = await Promise.all(entries.map(([_, promise]) => promise))

//   for (const result of results) {
//     if (isErrored(result)) {
//       return result
//     }
//   }

//   const values: any = {}
//   entries.forEach(([key], index) => {
//     values[key] = (results[index] as any).value
//   })

//   return complete(values)
// }
