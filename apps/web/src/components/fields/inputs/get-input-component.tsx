// apps/web/src/components/fields/inputs/get-input-component.tsx

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import type { ReactNode } from 'react'
import { ActorInputField } from './actor-input-field'
import { AddressInputField } from './address-input-field'
import { AddressStructInputField } from './address-struct-input-field'
import { CheckboxInputField } from './checkbox-input-field'
import { CurrencyInputField } from './currency-input-field'
import { DateInputField } from './date-input-field'
import { EmailInputField } from './email-input-field'
import { FileInputField } from './file-input-field'
import { JsonInputField } from './json-input-field'
import { NameInputField } from './name-input-field'
import { NumberInputField } from './number-input-field'
import { PhoneInputField } from './phone-input-field'
import { RelationshipInputField } from './relationship-input-field'
import { RichTextInputField } from './rich-text-input-field'
import { SelectInputField } from './select-input-field'
import { TextInputField } from './text-input-field'
import { UrlInputField } from './url-input-field'

/**
 * Returns the appropriate input component for a field type.
 * Used by both FieldInput (drawer) and CellFieldEditor (table).
 */
export function getInputComponentForFieldType(fieldType: FieldType): ReactNode {
  switch (fieldType) {
    case FieldTypeEnum.TEXT:
      return <TextInputField />
    case FieldTypeEnum.NUMBER:
      return <NumberInputField />
    case FieldTypeEnum.CURRENCY:
      return <CurrencyInputField />
    case FieldTypeEnum.DATE:
    case FieldTypeEnum.DATETIME:
    case FieldTypeEnum.TIME:
      return <DateInputField />
    case FieldTypeEnum.EMAIL:
      return <EmailInputField />
    case FieldTypeEnum.URL:
      return <UrlInputField />
    case FieldTypeEnum.CHECKBOX:
      return <CheckboxInputField />
    case FieldTypeEnum.SINGLE_SELECT:
    case FieldTypeEnum.MULTI_SELECT:
    case FieldTypeEnum.TAGS:
      return <SelectInputField />
    case FieldTypeEnum.PHONE_INTL:
      return <PhoneInputField />
    case FieldTypeEnum.RICH_TEXT:
      return <RichTextInputField />
    case FieldTypeEnum.FILE:
      return <FileInputField />
    case FieldTypeEnum.ADDRESS:
      return <AddressInputField />
    case FieldTypeEnum.ADDRESS_STRUCT:
      return <AddressStructInputField />
    case FieldTypeEnum.NAME:
      return <NameInputField />
    case FieldTypeEnum.RELATIONSHIP:
      return <RelationshipInputField />
    case FieldTypeEnum.ACTOR:
      return <ActorInputField />
    case FieldTypeEnum.JSON:
      return <JsonInputField />
    default:
      return <TextInputField />
  }
}
