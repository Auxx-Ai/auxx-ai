// packages/sdk/src/client/forms/base.ts

import type { SerializedFormValue } from './types.js'

/**
 * Base class for all form field types.
 * Each field type builds metadata for reconstruction on web app side.
 *
 * IMPORTANT: We only store metadata, not Zod schemas.
 * Zod schemas are reconstructed on the web app side from this metadata.
 */
// @ts-ignore - T is used for type inference only
export abstract class FormValue<T = any> {
  /**
   * Field metadata for serialization.
   * This is public so TypeScript can infer optional fields.
   */
  public readonly _metadata: Record<string, any>

  constructor(metadata: Record<string, any> = {}) {
    this._metadata = metadata
  }

  /**
   * Get the field type identifier.
   * Used during reconstruction to determine which component to render.
   */
  abstract get type(): string

  /**
   * Serialize this field definition to JSON.
   * This is what gets sent to the web app for reconstruction.
   */
  abstract toJSON(): SerializedFormValue

  /**
   * Type guard helper.
   */
  static is(value: unknown): value is FormValue {
    return value instanceof FormValue
  }
}
