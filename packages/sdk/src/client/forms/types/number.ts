// packages/sdk/src/client/forms/types/number.ts

import { FormValue } from '../base.js'
import type { SerializedFormValue, FormNumberMetadata } from '../types.js'

/**
 * Number field builder.
 */
export class FormNumber extends FormValue<number> {
  public readonly _metadata: FormNumberMetadata

  private constructor(metadata: FormNumberMetadata) {
    super(metadata)
    this._metadata = metadata
  }

  static create(): FormNumber {
    return new FormNumber({})
  }

  static is(value: unknown): value is FormNumber {
    return value instanceof FormNumber
  }

  get type(): 'number' {
    return 'number' as const
  }

  optional(): FormNumber {
    return new FormNumber({
      ...this._metadata,
      optional: true,
    })
  }

  min(value: number, message?: string): FormNumber {
    return new FormNumber({
      ...this._metadata,
      min: value,
      errorMessages: {
        ...this._metadata.errorMessages,
        min: message,
      },
    })
  }

  max(value: number, message?: string): FormNumber {
    return new FormNumber({
      ...this._metadata,
      max: value,
      errorMessages: {
        ...this._metadata.errorMessages,
        max: message,
      },
    })
  }

  integer(message?: string): FormNumber {
    return new FormNumber({
      ...this._metadata,
      integer: true,
      errorMessages: {
        ...this._metadata.errorMessages,
        integer: message,
      },
    })
  }

  positive(message?: string): FormNumber {
    return new FormNumber({
      ...this._metadata,
      positive: true,
      errorMessages: {
        ...this._metadata.errorMessages,
        positive: message,
      },
    })
  }

  placeholder(text: string): FormNumber {
    return new FormNumber({
      ...this._metadata,
      placeholder: text,
    })
  }

  default(value: number): FormNumber {
    return new FormNumber({
      ...this._metadata,
      defaultValue: value,
    })
  }

  toJSON(): SerializedFormValue {
    return {
      type: this.type,
      metadata: this._metadata,
    }
  }
}
