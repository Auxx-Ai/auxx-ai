// ~/components/contacts/fields/AddressComponentsEditor.tsx
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Label } from '@auxx/ui/components/label'

const ADDRESS_COMPONENTS = [
  { id: 'street1', label: 'Street Address' },
  { id: 'street2', label: 'Apartment/Suite' },
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State/Province' },
  { id: 'zipCode', label: 'ZIP/Postal Code' },
  { id: 'country', label: 'Country' },
]

interface AddressComponentsEditorProps {
  components: string[]
  onChange: (components: string[]) => void
}

export function AddressComponentsEditor({ components, onChange }: AddressComponentsEditorProps) {
  // Toggle address component
  const toggleComponent = (component: string) => {
    if (components.includes(component)) {
      onChange(components.filter((c) => c !== component))
    } else {
      onChange([...components, component])
    }
  }

  return (
    <div className="mb-0 rounded-xl border pt-1 pb-3 px-1 bg-primary-50 relative">
      <Label className="ps-1 mb-3 ">Address Components</Label>
      <div className="pt-2">
        <div className="grid grid-cols-2 gap-2">
          {ADDRESS_COMPONENTS.map((component) => (
            <div key={component.id} className="flex items-center space-x-2">
              <Checkbox
                id={`component-${component.id}`}
                checked={components.includes(component.id)}
                onCheckedChange={() => toggleComponent(component.id)}
              />
              <Label htmlFor={`component-${component.id}`}>{component.label}</Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
