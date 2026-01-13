import DisplayWrapper from './display-wrapper'
import { useFieldContext } from './display-field'

/**
 * DisplayName component
 * Renders compound firstName + lastName field
 */
export function DisplayName() {
  const { value } = useFieldContext()

  // Handle empty name
  if (!value || (typeof value === 'object' && !value.firstName && !value.lastName)) {
    return <DisplayWrapper copyValue={null}>-</DisplayWrapper>
  }

  // Handle string value (fallback)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return <DisplayWrapper copyValue={trimmed || null}>{trimmed || '-'}</DisplayWrapper>
  }

  // Handle object with firstName/lastName
  if (typeof value === 'object') {
    const { firstName = '', lastName = '' } = value
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

    if (!fullName) {
      return <DisplayWrapper copyValue={null}>-</DisplayWrapper>
    }

    return <DisplayWrapper copyValue={fullName}>{fullName}</DisplayWrapper>
  }

  return <DisplayWrapper copyValue={null}>-</DisplayWrapper>
}
