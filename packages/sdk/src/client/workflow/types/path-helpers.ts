// packages/sdk/src/client/workflow/types/path-helpers.ts

import type { WorkflowFieldNode } from '../../../root/workflow/base-node.js'

/**
 * Recursion depth limit (0-5)
 */
type Depth = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Map depth to previous depth for recursion control
 */
type PrevDepth = { 0: 0; 1: 0; 2: 1; 3: 2; 4: 3; 5: 4 }

/**
 * Check if type is a plain object (not array, function, etc.)
 */
type PlainObject<T> = T extends object
  ? T extends any[]
    ? false
    : T extends (...args: any) => any
    ? false
    : true
  : false

/**
 * Check if a value matches the field shape { type: TType }
 */
type IsFieldOfType<V, TT extends string> = V extends { type: infer U }
  ? U extends TT
    ? TT extends U
      ? true
      : false
    : false
  : false

/**
 * Internal recursive type for PathTo
 */
type PathToInner<T, TType extends string, D extends Depth> = {
  [K in Extract<keyof T, string>]: IsFieldOfType<T[K], TType> extends true
    ? K
    : D extends 0
    ? never
    : PlainObject<T[K]> extends true
    ? `${K}.${PathToInner<T[K], TType, PrevDepth[D]>}`
    : never
}[Extract<keyof T, string>]

/**
 * Type helper to extract dot-paths to fields of a specific type in a schema.
 *
 * - Recurses into plain objects only (no arrays/functions)
 * - Includes matches at the deepest allowed level, but won't go deeper
 * - Default max depth is 5 levels
 *
 * @example
 * ```typescript
 * type Schema = {
 *   name: { type: 'string' };
 *   age: { type: 'number' };
 *   email: { type: 'string' };
 *   address: {
 *     street: { type: 'string' };
 *     city: { type: 'string' };
 *   }
 * }
 *
 * type StringPaths = PathTo<Schema, 'string'>
 * // Result: 'name' | 'email' | 'address.street' | 'address.city'
 * ```
 */
export type PathTo<T, TType extends string, MaxDepth extends Depth = 5> = PathToInner<
  T,
  TType,
  MaxDepth
>

/**
 * Check if a value is a WorkflowFieldNode of a specific type.
 * Uses the generic type parameter from the base class.
 */
type IsFieldNodeOfType<V, TT extends string> = V extends WorkflowFieldNode<
  infer U,
  any,
  any
>
  ? U extends TT
    ? TT extends U
      ? true
      : false
    : false
  : false

/**
 * Internal recursive type for PathToField.
 * Works with class instances (WorkflowStringNode, etc.) not inferred types.
 */
type PathToFieldInner<T, TType extends string, D extends Depth> = {
  [K in Extract<keyof T, string>]: IsFieldNodeOfType<T[K], TType> extends true
    ? K
    : D extends 0
    ? never
    : PlainObject<T[K]> extends true
    ? `${K}.${PathToFieldInner<T[K], TType, PrevDepth[D]>}`
    : never
}[Extract<keyof T, string>]

/**
 * Type helper to extract dot-paths to workflow field nodes of a specific type.
 *
 * This works with class instances (WorkflowStringNode, etc.) not inferred types.
 * Use this when working with raw schema definitions.
 *
 * - Recurses into plain objects only (no arrays/functions)
 * - Includes matches at the deepest allowed level, but won't go deeper
 * - Default max depth is 5 levels
 *
 * @example
 * ```typescript
 * const schema = {
 *   inputs: {
 *     to: string({ label: 'To' }),
 *     subject: string({ label: 'Subject' }),
 *     settings: {
 *       priority: select({ options: [...] })
 *     }
 *   }
 * }
 *
 * type StringFields = PathToField<typeof schema.inputs, 'string'>
 * // Result: 'to' | 'subject'
 * ```
 */
export type PathToField<T, TType extends string, MaxDepth extends Depth = 5> = PathToFieldInner<
  T,
  TType,
  MaxDepth
>

/**
 * Extract the value type for a given path in a schema
 */
export type ValueAtPath<T, TPath extends string> = TPath extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? ValueAtPath<T[K], Rest>
    : never
  : TPath extends keyof T
  ? T[TPath]
  : never
