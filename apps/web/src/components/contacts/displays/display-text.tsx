import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../drawer/property-provider'

/**
 * DisplayText component
 * Renders plain text value
 */
export function DisplayText() {
  const { value, field } = usePropertyContext()

  // Check if value exists but is empty string
  if (value === '') {
    return <DisplayWrapper copyValue={value}>{value}</DisplayWrapper>
  }

  const maxRows = field?.options?.displayedMaxRows
  if (maxRows && typeof value === 'string') {
    const lines = value.split('\n').slice(0, maxRows)
    return (
      <DisplayWrapper copyValue={value}>
        <span>
          {lines.join('\n')}
          {value.split('\n').length > maxRows ? '\u2026' : ''}
        </span>
      </DisplayWrapper>
    )
  }
  const stringValue = value == null ? '' : String(value)
  return (
    <DisplayWrapper copyValue={stringValue || null}>
      {stringValue || '-'}
    </DisplayWrapper>
  )
}
