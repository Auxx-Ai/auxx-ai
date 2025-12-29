import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../drawer/property-provider'
import { Badge } from '@auxx/ui/components/badge'

/**
 * DisplayContactStatus component
 * Renders customer status as a colored badge
 */
export function DisplayContactStatus() {
  const { value } = usePropertyContext()

  // Handle empty status
  if (!value || value === '') {
    return <DisplayWrapper copyValue={null}>-</DisplayWrapper>
  }

  // Define status colors and labels
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return { label: 'Active', variant: 'default' as const }
      case 'INACTIVE':
        return { label: 'Inactive', variant: 'secondary' as const }
      case 'SPAM':
        return { label: 'Spam', variant: 'destructive' as const }
      case 'MERGED':
        return { label: 'Merged', variant: 'outline' as const }
      default:
        return { label: status, variant: 'secondary' as const }
    }
  }

  const statusValue = typeof value === 'string' ? value : String(value)
  const { label, variant } = getStatusDisplay(statusValue)

  return (
    <DisplayWrapper copyValue={label}>
      <Badge variant={variant}>{label}</Badge>
    </DisplayWrapper>
  )
}
