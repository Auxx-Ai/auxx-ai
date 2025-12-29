'use client'

// filepath: /Users/mklooth/Sites/auxx-ai/apps/web/src/components/pickers/combo-picker-demo.tsx
import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { ComboPicker, Option } from './combo-picker'

/**
 * Demo component for ComboPicker
 * Shows both single and multi-select modes to test functionality
 */
export default function ComboPickerDemo() {
  // Demo options
  const options: Option[] = [
    { value: 'apple', label: 'Apple', emoji: '🍎' },
    { value: 'banana', label: 'Banana', emoji: '🍌' },
    { value: 'orange', label: 'Orange', emoji: '🍊' },
    { value: 'grape', label: 'Grape', emoji: '🍇' },
    { value: 'kiwi', label: 'Kiwi', emoji: '🥝' },
  ]

  // Single select state
  const [singleSelected, setSingleSelected] = useState<Option | null>(null)
  const [singleOpen, setSingleOpen] = useState(false)

  // Multi select state
  const [multiSelected, setMultiSelected] = useState<Option[]>([])
  const [multiOpen, setMultiOpen] = useState(false)

  return (
    <div className="flex flex-col gap-8 p-8">
      <Card>
        <CardHeader>
          <CardTitle>ComboPicker Demo</CardTitle>
          <CardDescription>Test the component's functionality</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Single select demo */}
          <div>
            <h3 className="text-lg font-medium mb-2">Single Select</h3>
            <div className="flex items-center gap-4">
              <ComboPicker
                options={options}
                selected={singleSelected}
                onChange={setSingleSelected}
                open={singleOpen}
                onOpen={() => setSingleOpen(true)}
                onClose={() => setSingleOpen(false)}
                multi={false}>
                <Button variant="outline" className="w-full justify-between">
                  {singleSelected ? singleSelected.label : 'Select a fruit...'}
                </Button>
              </ComboPicker>
              <div>Selected: {singleSelected ? singleSelected.label : 'None'}</div>
            </div>
          </div>

          {/* Multi select demo */}
          <div>
            <h3 className="text-lg font-medium mb-2">Multi Select</h3>
            <div className="flex items-center gap-4">
              <ComboPicker
                options={options}
                selected={multiSelected}
                onChange={(selected) => {
                  if (Array.isArray(selected)) {
                    setMultiSelected(selected)
                  }
                }}
                open={multiOpen}
                onOpen={() => setMultiOpen(true)}
                onClose={() => setMultiOpen(false)}
                multi={true}>
                <Button variant="outline" className="w-full justify-between">
                  {multiSelected.length > 0
                    ? `${multiSelected.length} selected`
                    : 'Select fruits...'}
                </Button>
              </ComboPicker>
              <div>Selected: {multiSelected.map((opt) => opt.label).join(', ') || 'None'}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
