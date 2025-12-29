// apps/web/src/components/contacts/input/get-input-component.tsx

import type { ReactNode } from 'react'
import { FieldType } from '@auxx/database/enums'
import { TextInputField } from './text-input-field'
import { NumberInputField } from './number-input-field'
import { CurrencyInputField } from './currency-input-field'
import { DateInputField } from './date-input-field'
import { EmailInputField } from './email-input-field'
import { UrlInputField } from './url-input-field'
import { CheckboxInputField } from './checkbox-input-field'
import { TagsInputField } from './tags-input-field'
import { PhoneInputField } from './phone-input-field'
import { RichTextInputField } from './rich-text-input-field'
import { FileInputField } from './file-input-field'
import { AddressInputField } from './address-input-field'
import { AddressStructInputField } from './address-struct-input-field'
import { SingleSelectInputField } from './single-select-input-field'
import { MultiSelectInputField } from './multi-select-input-field'
import { ContactNameInputField } from './contact-name-input-field'
import { RelationshipInputField } from './relationship-input-field'

/**
 * Returns the appropriate input component for a field type.
 * Used by both FieldInput (drawer) and CellFieldEditor (table).
 */
export function getInputComponentForFieldType(fieldType: string): ReactNode {
  switch (fieldType) {
    case FieldType.TEXT:
      return <TextInputField />
    case FieldType.NUMBER:
      return <NumberInputField />
    case FieldType.CURRENCY:
      return <CurrencyInputField />
    case FieldType.DATE:
    case FieldType.DATETIME:
    case FieldType.TIME:
      return <DateInputField />
    case FieldType.EMAIL:
      return <EmailInputField />
    case FieldType.URL:
      return <UrlInputField />
    case FieldType.CHECKBOX:
      return <CheckboxInputField />
    case FieldType.TAGS:
      return <TagsInputField />
    case FieldType.PHONE_INTL:
      return <PhoneInputField />
    case FieldType.RICH_TEXT:
      return <RichTextInputField />
    case FieldType.FILE:
      return <FileInputField />
    case FieldType.ADDRESS:
      return <AddressInputField />
    case FieldType.ADDRESS_STRUCT:
      return <AddressStructInputField />
    case FieldType.SINGLE_SELECT:
      return <SingleSelectInputField />
    case FieldType.MULTI_SELECT:
      return <MultiSelectInputField />
    case FieldType.NAME:
      return <ContactNameInputField />
    case FieldType.RELATIONSHIP:
      return <RelationshipInputField />
    default:
      return <TextInputField />
  }
}
