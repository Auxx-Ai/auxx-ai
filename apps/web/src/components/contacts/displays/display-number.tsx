import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../drawer/property-provider'

/**
 * DisplayNumber component
 * Renders a number value
 */
export function DisplayNumber() {
  const { value } = usePropertyContext()
  const hasValue = value !== undefined && value !== null
  const stringValue = hasValue ? String(value) : ''
  return <DisplayWrapper copyValue={hasValue ? stringValue : null}>{hasValue ? value : '-'}</DisplayWrapper>
}
