// packages/sdk/src/client/forms/types/boolean.ts

import { FormValue } from '../base.js'
import type { FormBooleanMetadata, SerializedFormValue } from '../types.js'

/**
 * Boolean field builder (renders as checkbox).
 */
export class FormBoolean extends FormValue<boolean> {
  public readonly _metadata: FormBooleanMetadata

  private constructor(metadata: FormBooleanMetadata) {
    super(metadata)
    this._metadata = metadata
  }

  static create(): FormBoolean {
    return new FormBoolean({ defaultValue: false })
  }

  static is(value: unknown): value is FormBoolean {
    return value instanceof FormBoolean
  }

  get type(): 'boolean' {
    return 'boolean' as const
  }

  default(value: boolean): FormBoolean {
    return new FormBoolean({
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
