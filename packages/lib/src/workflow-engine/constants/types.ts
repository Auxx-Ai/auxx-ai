// packages/lib/src/workflow-engine/constants/types.ts

/**
 * Configuration for a numeric range with validation
 */
export interface RangeConfig<T extends number = number> {
  min: T
  max: T
  default: T
}

/**
 * Extended range config with validation methods
 */
export interface ValidatedRangeConfig<T extends number = number> extends RangeConfig<T> {
  validate: (value: unknown) => value is T
  clamp: (value: number) => T
}

/**
 * Base structure for node constants
 */
export interface NodeConstants {
  readonly [key: string]: unknown
}

/**
 * Utility type to extract the values from a readonly array
 */
export type ArrayValues<T extends ReadonlyArray<unknown>> = T[number]
