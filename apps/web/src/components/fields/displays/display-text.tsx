// apps/web/src/components/fields/displays/display-text.tsx

import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'

/**
 * DisplayText component
 * Renders plain text value. Fields configured as multiline wrap onto several
 * lines and scroll internally past the cap; everything else stays single-line.
 */
export function DisplayText() {
  const { value, field } = useFieldContext()
  const wrap = field?.options?.multiline === true

  // Distinct from a null/absent value: an explicit empty string renders blank
  // rather than the `-` placeholder, and offers nothing to copy.
  if (value === '') {
    return <DisplayWrapper copyValue={value}>{value}</DisplayWrapper>
  }

  const stringValue = value == null ? '' : String(value)
  return (
    <DisplayWrapper wrap={wrap} copyValue={stringValue || null}>
      {stringValue || '-'}
    </DisplayWrapper>
  )
}
