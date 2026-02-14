// components/tickets/ticket-forms/return-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Calendar } from '@auxx/ui/components/calendar'
import { FormLabel } from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Textarea } from '@auxx/ui/components/textarea'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'

interface ReturnFormProps {
  form: UseFormReturn<any>
  data: {
    orderId: string
    orderDate?: Date
    returnItems: Array<{
      name: string
      quantity: number
      sku: string
      reason: string
    }>
    returnReason: string
  }
  setData: (data: any) => void
}

export function ReturnForm({ form, data, setData }: ReturnFormProps) {
  // Handle return item functions
  const addReturnItem = () => {
    setData({
      ...data,
      returnItems: [...data.returnItems, { name: '', quantity: 1, sku: '', reason: '' }],
    })
  }

  const removeReturnItem = (index: number) => {
    if (data.returnItems.length > 1) {
      setData({
        ...data,
        returnItems: data.returnItems.filter((_, i) => i !== index),
      })
    }
  }

  const updateReturnItem = (index: number, field: string, value: any) => {
    const updatedItems = [...data.returnItems]
    updatedItems[index] = { ...updatedItems[index], [field]: value }
    setData({ ...data, returnItems: updatedItems })
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        {/* Order ID field */}
        <div className='flex flex-col space-y-1.5'>
          <FormLabel>Order ID</FormLabel>
          <Input
            value={data.orderId}
            onChange={(e) => setData({ ...data, orderId: e.target.value })}
            placeholder='Enter order ID'
          />
        </div>

        {/* Order Date field */}
        <div className='flex flex-col space-y-1.5'>
          <FormLabel>Order Date</FormLabel>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={'outline-solid'}
                className={`w-full pl-3 text-left font-normal ${
                  !data.orderDate ? 'text-muted-foreground' : ''
                }`}>
                {data.orderDate ? format(data.orderDate, 'PPP') : <span>Pick a date</span>}
                <CalendarIcon className='ml-auto h-4 w-4 opacity-50' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-auto p-0' align='start'>
              <Calendar
                mode='single'
                selected={data.orderDate}
                onSelect={(date) => setData({ ...data, orderDate: date })}
                disabled={(date) => date > new Date(new Date().setHours(23, 59, 59, 999))}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div>
        <div className='mb-2 flex items-center justify-between'>
          <FormLabel>Return Items</FormLabel>
          <Button type='button' variant='outline' size='sm' onClick={addReturnItem}>
            Add Item
          </Button>
        </div>

        {data.returnItems.map((item, index) => (
          <div key={index} className='mb-2 grid grid-cols-12 items-center gap-2'>
            <div className='col-span-4'>
              <Input
                value={item.name}
                onChange={(e) => updateReturnItem(index, 'name', e.target.value)}
                placeholder='Item name'
              />
            </div>
            <div className='col-span-2'>
              <Input
                type='number'
                value={item.quantity}
                min={1}
                onChange={(e) => updateReturnItem(index, 'quantity', e.target.value)}
                placeholder='Qty'
              />
            </div>
            <div className='col-span-2'>
              <Input
                value={item.sku}
                onChange={(e) => updateReturnItem(index, 'sku', e.target.value)}
                placeholder='SKU'
              />
            </div>
            <div className='col-span-3'>
              <Input
                value={item.reason}
                onChange={(e) => updateReturnItem(index, 'reason', e.target.value)}
                placeholder='Reason'
              />
            </div>
            <div className='col-span-1'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => removeReturnItem(index)}
                disabled={data.returnItems.length <= 1}>
                &times;
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className='flex flex-col space-y-1.5'>
        <FormLabel>Overall Return Reason</FormLabel>
        <Textarea
          value={data.returnReason}
          onChange={(e) => setData({ ...data, returnReason: e.target.value })}
          placeholder='Overall reason for the return'
          className='min-h-[80px]'
        />
      </div>
    </div>
  )
}
