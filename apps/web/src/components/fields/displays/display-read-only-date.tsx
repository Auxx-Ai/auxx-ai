import DisplayWrapper from './display-wrapper'
import { useFieldContext } from './display-field'
import { format } from 'date-fns'

/**
 * DisplayReadOnlyDate component
 * Renders formatted date value for read-only fields like createdAt/updatedAt
 */
export function DisplayReadOnlyDate() {
  const { value } = useFieldContext()

  // Handle empty or invalid dates
  if (!value || value === '') {
    return <DisplayWrapper copyValue={null}>-</DisplayWrapper>
  }

  try {
    const date = new Date(value)
    if (isNaN(date.getTime())) {
      return <DisplayWrapper copyValue={null}>Invalid date</DisplayWrapper>
    }

    const formattedDate = format(date, 'MMM d, yyyy h:mm a')
    return <DisplayWrapper copyValue={formattedDate}>{formattedDate}</DisplayWrapper>
  } catch (error) {
    return <DisplayWrapper copyValue={null}>Invalid date</DisplayWrapper>
  }
}
