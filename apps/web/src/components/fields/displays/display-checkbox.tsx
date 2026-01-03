import { Check, X } from 'lucide-react'
import { usePropertyContext } from '../property-provider'
import DisplayWrapper from './display-wrapper'

/**
 * DisplayCheckbox component
 * Renders a checkbox value
 */
export function DisplayCheckbox() {
  const { value } = usePropertyContext()
  const label = value ? 'True' : 'False'
  return (
    <DisplayWrapper copyValue={label}>
      {value ? (
        <div className="flex items-center justify-center gap-2">
          <Check className="h-4 w-4 " />
          <span className="text-muted-foreground">True</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2">
          <X className="h-4 w-4 " />
          <span className="text-muted-foreground">False</span>
        </div>
      )}
    </DisplayWrapper>
  )
}
