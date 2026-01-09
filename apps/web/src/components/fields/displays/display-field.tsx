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
import { usePropertyContext } from '../property-provider'
import { FieldType } from '@auxx/database/enums'
/**
 * DisplayField component
 * Renders the correct display component for a contact field type
 */
export function DisplayField() {
  const { field } = usePropertyContext()
  switch (field.fieldType) {
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
    default:
      return <DisplayText />
  }
}
