// packages/lib/src/workflow-engine/constants/validation.ts
import type { RangeConfig, ValidatedRangeConfig } from './types'

/**
 * Creates a validated range configuration with helper methods
 */
export function createRangeValidator<T extends number = number>(
  config: RangeConfig<T>
): ValidatedRangeConfig<T> {
  return {
    ...config,
    validate: (value: unknown): value is T => {
      return typeof value === 'number' && value >= config.min && value <= config.max
    },
    clamp: (value: number): T => {
      return Math.max(config.min, Math.min(config.max, value)) as T
    },
  }
}

/**
 * Creates a validator for enum values
 */
export function createEnumValidator<T extends readonly string[]>(values: T) {
  return {
    values,
    validate: (value: unknown): value is T[number] => {
      return typeof value === 'string' && values.includes(value)
    },
    getDefault: (): T[0] => values[0],
  }
}

/**
 * Helper to ensure a value is within range
 */
export function ensureInRange<T extends number>(value: number, config: RangeConfig<T>): T {
  return Math.max(config.min, Math.min(config.max, value)) as T
}

/**
 * Helper to get default value if undefined
 */
export function withDefault<T>(value: T | undefined, defaultValue: T): T {
  return value !== undefined ? value : defaultValue
}
