// apps/web/src/components/fields/displays/display-text.tsx

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'
import { maskSensitive } from './mask-sensitive'

/**
 * DisplayText component
 * Renders plain text value. Fields configured as multiline wrap onto several
 * lines and scroll internally past the cap; everything else stays single-line.
 *
 * 🛑 A field marked `sensitive` (a vendor's TIN is the motivating case) renders
 * masked to its last four characters with a reveal toggle. The toggle is
 * per-row and resets on unmount - revealing one TIN must never reveal the next
 * record's. Copy still yields the REAL value: anybody who can reveal it can
 * copy it, and a clipboard full of bullets is a bug, not a safeguard.
 *
 * ⚠️ This is a display hint and not an access control - see
 * `ResourceField.sensitive`.
 */
export function DisplayText() {
  const { value, field } = useFieldContext()
  const [revealed, setRevealed] = useState(false)
  const wrap = field?.options?.multiline === true

  // Distinct from a null/absent value: an explicit empty string renders blank
  // rather than the `-` placeholder, and offers nothing to copy.
  if (value === '') {
    return <DisplayWrapper copyValue={value}>{value}</DisplayWrapper>
  }

  const stringValue = value == null ? '' : String(value)
  const isSensitive = field?.sensitive === true && stringValue !== ''

  if (isSensitive) {
    return (
      <DisplayWrapper
        wrap={false}
        copyValue={stringValue}
        buttons={[
          <FieldOptionButton
            key='reveal'
            label={revealed ? 'Hide' : 'Reveal'}
            onClick={() => setRevealed((r) => !r)}>
            {revealed ? <EyeOff className='size-2.5' /> : <Eye className='size-2.5' />}
          </FieldOptionButton>,
        ]}>
        <span className={revealed ? undefined : 'tracking-wider'}>
          {revealed ? stringValue : maskSensitive(stringValue)}
        </span>
      </DisplayWrapper>
    )
  }

  return (
    <DisplayWrapper wrap={wrap} copyValue={stringValue || null}>
      {stringValue || '-'}
    </DisplayWrapper>
  )
}
