// apps/web/src/components/fields/displays/display-field.tsx

import { DisplayDate } from './display-date'
import { DisplayText } from './display-text'
import { DisplayNumber } from './display-number'
import { DisplayCurrency } from './display-currency'
import { DisplayPhone } from './display-phone'
import { DisplayEmail } from './display-email'
import { DisplayUrl } from './display-url'
import { DisplayCheckbox } from './display-checkbox'
import { DisplayTags } from './display-tags'
import { DisplayAddress, DisplayAddressStruct } from './display-address'
import { DisplaySingleSelect } from './display-single-select'
import { DisplayMultiSelect } from './display-multi-select'
import { DisplayRichText } from './display-rich-text'
import { DisplayFile } from './display-file'
import { DisplayName } from './display-name'
import { DisplayRelationship } from './display-relationship'
import { DisplayActor } from './display-actor'
import { usePropertyContext } from '../property-provider'
import { useDisplayOnlyContext } from '../display-only-provider'
import { FieldType } from '@auxx/database/enums'

/**
 * Helper hook that tries PropertyContext first (editable fields),
 * then falls back to DisplayOnlyContext (read-only display).
 */
export function useFieldContext() {
  try {
    return usePropertyContext()
  } catch {
    return useDisplayOnlyContext()
  }
}

/**
 * Get the effective field type for rendering.
 * For CALC fields, returns the resultFieldType; otherwise returns the field's type.
 */
function getEffectiveFieldType(field: { fieldType: string; options?: { calc?: { resultFieldType?: string } } }): string {
  if (field.fieldType === FieldType.CALC) {
    return field.options?.calc?.resultFieldType ?? FieldType.TEXT
  }
  return field.fieldType
}

/**
 * DisplayField component
 * Renders the correct display component for a field type.
 * For CALC fields, uses the resultFieldType to determine which display component to render.
 */
export function DisplayField() {
  const { field } = useFieldContext()
  const effectiveFieldType = getEffectiveFieldType(field)

  switch (effectiveFieldType) {
    case FieldType.DATE:
    case FieldType.DATETIME:
    case FieldType.TIME:
      return <DisplayDate />
    case FieldType.TEXT:
      return <DisplayText />
    case FieldType.NUMBER:
      return <DisplayNumber />
    case FieldType.CURRENCY:
      return <DisplayCurrency />
    case FieldType.PHONE_INTL:
      return <DisplayPhone />
    case FieldType.EMAIL:
      return <DisplayEmail />
    case FieldType.URL:
      return <DisplayUrl />
    case FieldType.CHECKBOX:
      return <DisplayCheckbox />
    case FieldType.TAGS:
      return <DisplayTags />
    case FieldType.ADDRESS:
      return <DisplayAddress />
    case FieldType.ADDRESS_STRUCT:
      return <DisplayAddressStruct />
    case FieldType.SINGLE_SELECT:
      return <DisplaySingleSelect />
    case FieldType.MULTI_SELECT:
      return <DisplayMultiSelect />
    case FieldType.RICH_TEXT:
      return <DisplayRichText />
    case FieldType.FILE:
      return <DisplayFile />
    case FieldType.NAME:
      return <DisplayName />
    case FieldType.RELATIONSHIP:
      return <DisplayRelationship />
    case FieldType.ACTOR:
      return <DisplayActor />
    default:
      return <DisplayText />
  }
}
