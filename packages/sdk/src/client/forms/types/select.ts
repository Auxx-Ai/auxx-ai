// packages/sdk/src/client/forms/types/select.ts

import { FormValue } from '../base.js'
import type { SerializedFormValue, FormSelectMetadata, SelectOption } from '../types.js'

/**
 * Select field builder.
 */
export class FormSelect<T extends string = string> extends FormValue<T> {
  public readonly _metadata: FormSelectMetadata<T>

  private constructor(metadata: FormSelectMetadata<T>) {
    super(metadata)
    this._metadata = metadata
  }

  static create<T extends string>(options: SelectOption<T>[]): FormSelect<T> {
    if (!options || options.length === 0) {
      throw new Error('FormSelect requires at least one option')
    }

    return new FormSelect<T>({ options })
  }

  static is(value: unknown): value is FormSelect {
    return value instanceof FormSelect
  }

  get type(): 'select' {
    return 'select' as const
  }

  optional(): FormSelect<T> {
    return new FormSelect<T>({
      ...this._metadata,
      optional: true,
    })
  }

  placeholder(text: string): FormSelect<T> {
    return new FormSelect<T>({
      ...this._metadata,
      placeholder: text,
    })
  }

  default(value: T): FormSelect<T> {
    // Validate that the default value is in the options
    const validValues = this._metadata.options.map((opt) => opt.value)
    if (!validValues.includes(value)) {
      throw new Error(
        `Default value "${value}" is not in options: ${validValues.join(', ')}`
      )
    }

    return new FormSelect<T>({
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
