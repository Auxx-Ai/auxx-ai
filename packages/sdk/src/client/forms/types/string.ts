// packages/sdk/src/client/forms/types/string.ts

import { FormValue } from '../base.js'
import type { SerializedFormValue, FormStringMetadata } from '../types.js'

/**
 * String field builder.
 *
 * @example
 * Forms.string()
 * Forms.string().optional()
 * Forms.string().email().minLength(5)
 * Forms.string().multiline().maxLength(500)
 */
export class FormString extends FormValue<string> {
  public readonly _metadata: FormStringMetadata

  private constructor(metadata: FormStringMetadata) {
    super(metadata)
    this._metadata = metadata
  }

  static create(): FormString {
    return new FormString({})
  }

  static is(value: unknown): value is FormString {
    return value instanceof FormString
  }

  get type(): 'string' {
    return 'string' as const
  }

  // Chainable builder methods

  optional(): FormString {
    return new FormString({
      ...this._metadata,
      optional: true,
    })
  }

  multiline(): FormString {
    return new FormString({
      ...this._metadata,
      multiline: true,
    })
  }

  minLength(length: number, message?: string): FormString {
    return new FormString({
      ...this._metadata,
      minLength: length,
      errorMessages: {
        ...this._metadata.errorMessages,
        minLength: message,
      },
    })
  }

  maxLength(length: number, message?: string): FormString {
    return new FormString({
      ...this._metadata,
      maxLength: length,
      errorMessages: {
        ...this._metadata.errorMessages,
        maxLength: message,
      },
    })
  }

  email(message?: string): FormString {
    return new FormString({
      ...this._metadata,
      email: true,
      errorMessages: {
        ...this._metadata.errorMessages,
        email: message,
      },
    })
  }

  url(message?: string): FormString {
    return new FormString({
      ...this._metadata,
      url: true,
      errorMessages: {
        ...this._metadata.errorMessages,
        url: message,
      },
    })
  }

  placeholder(text: string): FormString {
    return new FormString({
      ...this._metadata,
      placeholder: text,
    })
  }

  default(value: string): FormString {
    return new FormString({
      ...this._metadata,
      defaultValue: value,
    })
  }

  // Serialization for postMessage

  toJSON(): SerializedFormValue {
    return {
      type: this.type,
      metadata: this._metadata,
    }
  }
}
