// packages/sdk/src/client/forms/types/picker.ts

import { FormValue } from '../base.js'
import type {
  FormPickerMetadata,
  PickerLoadOptions,
  SelectOption,
  SerializedFormValue,
} from '../types.js'

/**
 * Config for {@link FormPicker}. Provide `loadOptions` for server-backed,
 * search-driven options, or `options` for a static / client-filtered list.
 */
export interface PickerConfig {
  loadOptions?: PickerLoadOptions
  options?: SelectOption[]
  multi?: boolean
}

/**
 * Picker field builder — a searchable, optionally server-backed select.
 *
 * Renders host-side as the platform's rich picker (`AsyncOptionPicker`). Unlike
 * {@link FormSelect} (a static `<Select>`), the picker can resolve options at
 * search time via `loadOptions`, which runs in the app sandbox and may call
 * `.server` functions.
 *
 * @example
 * Forms.picker({ loadOptions: searchStripeCandidates, multi: false })
 * Forms.picker({ options: [{ value, label }] })
 */
export class FormPicker<V extends string | string[] = string> extends FormValue<V> {
  public readonly _metadata: FormPickerMetadata

  private constructor(metadata: FormPickerMetadata) {
    super(metadata)
    this._metadata = metadata
  }

  static create(config: PickerConfig & { multi: true }): FormPicker<string[]>
  static create(config?: PickerConfig): FormPicker<string>
  static create(config: PickerConfig = {}): FormPicker<string | string[]> {
    if (!config.loadOptions && !config.options) {
      throw new Error('Forms.picker requires either `loadOptions` or `options`')
    }
    return new FormPicker({
      loadOptions: config.loadOptions,
      options: config.options,
      multi: config.multi ?? false,
    })
  }

  static is(value: unknown): value is FormPicker {
    return value instanceof FormPicker
  }

  get type(): 'picker' {
    return 'picker' as const
  }

  optional(): FormPicker<V> {
    return new FormPicker<V>({ ...this._metadata, optional: true })
  }

  placeholder(text: string): FormPicker<V> {
    return new FormPicker<V>({ ...this._metadata, placeholder: text })
  }

  toJSON(): SerializedFormValue {
    // Strip the runtime-only resolver; expose a flag instead. The form tag keeps
    // the live `loadOptions` and invokes it over the bridge.
    const { loadOptions, ...rest } = this._metadata
    return {
      type: this.type,
      metadata: { ...rest, hasLoadOptions: typeof loadOptions === 'function' },
    }
  }
}
