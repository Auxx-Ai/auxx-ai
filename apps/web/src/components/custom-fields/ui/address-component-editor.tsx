// apps/web/src/components/custom-fields/ui/address-component-editor.tsx

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'

/**
 * Available address component definitions, in render order.
 *
 * `name` and `residential` are opt-in additions
 * (plans/apps/shipstation/shipstation-workflow-expansion-plan.md §5) — they are deliberately
 * NOT in {@link DEFAULT_ADDRESS_COMPONENTS}, so an existing field keeps its current shape
 * until an admin checks them.
 */
const ADDRESS_COMPONENTS = [
  { id: 'name', label: 'Name' },
  { id: 'street1', label: 'Street Address' },
  { id: 'street2', label: 'Apartment/Suite' },
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State/Province' },
  { id: 'zipCode', label: 'ZIP/Postal Code' },
  { id: 'country', label: 'Country' },
  { id: 'residential', label: 'Residential' },
]

/** Default address components — the original six, all enabled. */
const DEFAULT_ADDRESS_COMPONENTS = ['street1', 'street2', 'city', 'state', 'zipCode', 'country']

/**
 * A component id no editor has ever produced.
 *
 * Five registry address fields (order/work_order/service_request/purchase_order/company) used
 * to ship `addressComponents: ['street', 'city', 'state', 'country']` — written before the
 * editor's id set existed, so it named `street` rather than `street1` and omitted
 * `street2`/`zipCode` entirely. Nothing read the option until Step 0c, so those literals were
 * inert. Honoring them literally would delete the ZIP line from every order, work order and
 * company address in every org, which no admin ever asked for, so a list carrying this id is
 * treated as un-configured and falls back to the defaults. The editor cannot emit `street`, so
 * this can never swallow a real admin choice.
 *
 * The registry literals are gone and entity migration
 * `150-strip-legacy-address-components` removes the stored lists per org, but this guard is
 * what keeps an org that has NOT yet run that migration rendering correctly. Remove it only
 * once 150 has run everywhere.
 */
const LEGACY_UNCONFIGURED_ID = 'street'

/**
 * Parse stored field options into editor state, and the single source of truth for which
 * sub-fields the three renderers show (`AddressStructFields`, `AddressSingleFields`,
 * `DisplayAddressStruct`).
 *
 * Returns {@link DEFAULT_ADDRESS_COMPONENTS} when the option is absent, empty, or a
 * pre-editor registry literal (see {@link LEGACY_UNCONFIGURED_ID}).
 */
export function parseAddressComponents(fieldOptions?: FieldOptions): string[] {
  const stored =
    fieldOptions &&
    'addressComponents' in fieldOptions &&
    Array.isArray(fieldOptions.addressComponents)
      ? fieldOptions.addressComponents
      : undefined

  if (!stored || stored.length === 0 || stored.includes(LEGACY_UNCONFIGURED_ID)) {
    return [...DEFAULT_ADDRESS_COMPONENTS]
  }
  return stored
}

/**
 * Format editor state into storage format.
 * Returns options object with addressComponents key for storage.
 */
export function formatAddressComponents(components: string[]): { addressComponents: string[] } {
  return { addressComponents: components }
}

/**
 * Address field input variant: a single free-text input (parsed locally and
 * normalized server-side by the geocoder — see
 * plans/address-field/01-single-input-address-field.md) vs. the separate
 * structured sub-fields. Absent on the stored field options ⇒ `'single'`.
 */
export type AddressInputMode = 'single' | 'structured'

/**
 * Parse stored field options into the input-mode editor state.
 * Anything other than `'structured'` (including absent) resolves to `'single'`.
 */
export function parseAddressInputMode(fieldOptions?: FieldOptions): AddressInputMode {
  return fieldOptions?.inputMode === 'structured' ? 'structured' : 'single'
}

/**
 * Format editor state into the submit payload. Always carries the current
 * mode (mirrors `addressComponents`, which is always sent as an array) — the
 * service layer is what omits the key from storage for the default `'single'`
 * mode (and clears a stale `'structured'` on revert); see
 * packages/services/src/custom-fields/{create,update}-field.ts.
 */
export function formatAddressInputMode(mode: AddressInputMode): { inputMode: AddressInputMode } {
  return { inputMode: mode }
}

/** Props for AddressInputModeEditor component */
interface AddressInputModeEditorProps {
  mode: AddressInputMode
  onChange: (mode: AddressInputMode) => void
}

/**
 * Select control for the address field's input style — single free-text line
 * (default) or the separate structured sub-fields.
 */
export function AddressInputModeEditor({ mode, onChange }: AddressInputModeEditorProps) {
  return (
    <div className='mb-3'>
      <Label className='ps-1 mb-1.5 block'>Input Style</Label>
      <Select value={mode} onValueChange={(v) => onChange(v as AddressInputMode)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='single'>Single line</SelectItem>
          <SelectItem value='structured'>Separate fields</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Props for AddressComponentsEditor component */
interface AddressComponentsEditorProps {
  components: string[]
  onChange: (components: string[]) => void
}

export function AddressComponentsEditor({ components, onChange }: AddressComponentsEditorProps) {
  // Toggle address component
  const toggleComponent = (component: string) => {
    if (components.includes(component)) {
      onChange(components.filter((c) => c !== component))
    } else {
      onChange([...components, component])
    }
  }

  return (
    <div className='mb-0 rounded-xl border pt-1 pb-3 px-1 bg-primary-50 relative'>
      <Label className='ps-1 mb-3 '>Address Components</Label>
      <div className='pt-2'>
        <div className='grid grid-cols-2 gap-2'>
          {ADDRESS_COMPONENTS.map((component) => (
            <div key={component.id} className='flex items-center space-x-2'>
              <Checkbox
                id={`component-${component.id}`}
                checked={components.includes(component.id)}
                onCheckedChange={() => toggleComponent(component.id)}
              />
              <Label htmlFor={`component-${component.id}`}>{component.label}</Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
