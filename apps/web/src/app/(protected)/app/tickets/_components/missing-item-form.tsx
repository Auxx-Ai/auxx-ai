// components/tickets/ticket-forms/missing-item-form.tsx
'use client'

import { type UseFormReturn } from 'react-hook-form'
import { FormLabel } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { Calendar } from '@auxx/ui/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { CalendarIcon } from 'lucide-react'
import { format } from 'date-fns'

interface MissingItemFormProps {
  form: UseFormReturn<any>
  typeData: Record<string, any>
  setTypeData: (updates: Record<string, any>) => void
}

export function MissingItemForm({ form, typeData, setTypeData }: MissingItemFormProps) {
  // Initialize missing items if not present
  const missingItems = typeData?.missingItems || [{ name: '', quantity: 1, sku: '' }]

  // Handle missing item functions
  const addMissingItem = () => {
    setTypeData({
      ...typeData,
      missingItems: [...missingItems, { name: '', quantity: 1, sku: '' }],
    })
  }

  const removeMissingItem = (index: number) => {
    if (missingItems.length > 1) {
      setTypeData({
        ...typeData,
        missingItems: missingItems.filter((_, i) => i !== index),
      })
    }
  }

  const updateMissingItem = (index: number, field: string, value: any) => {
    const updatedItems = [...missingItems]
    updatedItems[index] = { ...updatedItems[index], [field]: value }
    setTypeData({ ...typeData, missingItems: updatedItems })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Order ID field */}
        <div className="flex flex-col space-y-1.5">
          <FormLabel>Order ID</FormLabel>
          <Input
            value={typeData?.orderId || ''}
            onChange={(e) => setTypeData({ ...typeData, orderId: e.target.value })}
            placeholder="Enter order ID"
          />
        </div>

        {/* Order Date field */}
        <div className="flex flex-col space-y-1.5">
          <FormLabel>Order Date</FormLabel>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={'outline'}
                className={`w-full pl-3 text-left font-normal ${
                  !typeData?.orderDate ? 'text-muted-foreground' : ''
                }`}>
                {typeData?.orderDate ? (
                  format(typeData?.orderDate, 'PPP')
                ) : (
                  <span>Pick a date</span>
                )}
                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={typeData?.orderDate}
                onSelect={(date) => setTypeData({ ...typeData, orderDate: date })}
                disabled={(date) => date > new Date(new Date().setHours(23, 59, 59, 999))}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <FormLabel>Missing Items</FormLabel>
          <Button type="button" variant="outline" size="sm" onClick={addMissingItem}>
            Add Item
          </Button>
        </div>

        {missingItems.map((item, index) => (
          <div key={index} className="mb-2 grid grid-cols-12 items-center gap-2">
            <div className="col-span-6">
              <Input
                value={item.name}
                onChange={(e) => updateMissingItem(index, 'name', e.target.value)}
                placeholder="Item name"
              />
            </div>
            <div className="col-span-2">
              <Input
                type="number"
                value={item.quantity}
                min={1}
                onChange={(e) => updateMissingItem(index, 'quantity', e.target.value)}
                placeholder="Qty"
              />
            </div>
            <div className="col-span-3">
              <Input
                value={item.sku}
                onChange={(e) => updateMissingItem(index, 'sku', e.target.value)}
                placeholder="SKU (optional)"
              />
            </div>
            <div className="col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeMissingItem(index)}
                disabled={missingItems.length <= 1}>
                &times;
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
