// packages/sdk/src/shared/fetchable.ts

/**
 * Fetchable state machine for async operations.
 */
export enum FetchableState {
  PENDING = 'PENDING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}

export interface PendingFetchable {
  state: FetchableState.PENDING
}

export interface CompleteFetchable<T> {
  state: FetchableState.COMPLETE
  data: T
}

export interface ErrorFetchable {
  state: FetchableState.ERROR
  error: Error
}

export type Fetchable<T> = PendingFetchable | CompleteFetchable<T> | ErrorFetchable

// === Factory Functions ===

/**
 * Create a pending fetchable state.
 */
export function makePendingFetchable(): PendingFetchable {
  return { state: FetchableState.PENDING }
}

/**
 * Create a complete fetchable state with data.
 */
export function makeCompleteFetchable<T>(data: T): CompleteFetchable<T> {
  return { state: FetchableState.COMPLETE, data }
}

/**
 * Create an error fetchable state.
 */
export function makeErrorFetchable(error: Error): ErrorFetchable {
  return { state: FetchableState.ERROR, error }
}

// === Type Guards ===

/**
 * Check if fetchable is pending.
 */
export function isPendingFetchable<T>(f: Fetchable<T>): f is PendingFetchable {
  return f.state === FetchableState.PENDING
}

/**
 * Check if fetchable is complete.
 */
export function isCompleteFetchable<T>(f: Fetchable<T>): f is CompleteFetchable<T> {
  return f.state === FetchableState.COMPLETE
}

/**
 * Check if fetchable is error.
 */
export function isErrorFetchable<T>(f: Fetchable<T>): f is ErrorFetchable {
  return f.state === FetchableState.ERROR
}

// === Utility Functions ===

/**
 * Map over fetchable data if complete.
 */
export function mapFetchable<T, U>(fetchable: Fetchable<T>, fn: (data: T) => U): Fetchable<U> {
  if (isCompleteFetchable(fetchable)) {
    return makeCompleteFetchable(fn(fetchable.data))
  }
  return fetchable as PendingFetchable | ErrorFetchable
}

/**
 * Get data from fetchable or undefined.
 */
export function getFetchableData<T>(fetchable: Fetchable<T>): T | undefined {
  return isCompleteFetchable(fetchable) ? fetchable.data : undefined
}
