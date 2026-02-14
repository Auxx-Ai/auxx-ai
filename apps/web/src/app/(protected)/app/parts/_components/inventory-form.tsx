'use client'

// import { api } from '@auxx/lib/api/trpc' // Import your tRPC API
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Separator } from '@auxx/ui/components/separator'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { AlertTriangle, ArrowLeft, Loader2, MapPin, Package, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { api } from '~/trpc/react'

// Define the form schema
const formSchema = z.object({
  partId: z.string().min(1, 'Part is required'),
  quantity: z.coerce
    .number()
    .int('Quantity must be a whole number')
    .min(0, 'Quantity cannot be negative'),
  location: z.string().optional(),
  reorderPoint: z.coerce
    .number()
    .int('Reorder point must be a whole number')
    .min(0, 'Reorder point cannot be negative')
    .optional()
    .nullable(),
  reorderQty: z.coerce
    .number()
    .int('Reorder quantity must be a whole number')
    .min(1, 'Reorder quantity must be at least 1')
    .optional()
    .nullable(),
})

export function InventoryForm({
  partId = null,
  inventoryId = null, // If provided, we're editing an existing inventory record
  initialData = null,
}: {
  partId?: string | null
  inventoryId?: string | null
  initialData?: any
}) {
  const router = useRouter()
  const isEditing = !!inventoryId

  // Form state
  const [isLoading, setIsLoading] = useState(false)

  // Get part details
  const { data: part, isLoading: isLoadingPart } = api.part.byId.useQuery(
    { id: partId },
    { enabled: !!partId }
  )

  // Get existing inventory if editing
  const { data: inventory, isLoading: isLoadingInventory } = api.inventory.byId.useQuery(
    { id: partId },
    {
      enabled: !!inventoryId && !initialData,
      onSuccess: (data) => {
        if (data) {
          // Update form with the fetched data
          form.reset({
            partId: data.partId,
            quantity: data.quantity,
            location: data.location || '',
            reorderPoint: data.reorderPoint,
            reorderQty: data.reorderQty,
          })
        }
      },
    }
  )

  // Use initialData if provided, otherwise use fetched inventory data
  const existingData = initialData || inventory

  // Initialize the form
  const form = useForm({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      partId: partId || '',
      quantity: existingData?.quantity || 0,
      location: existingData?.location || '',
      reorderPoint: existingData?.reorderPoint || null,
      reorderQty: existingData?.reorderQty || null,
    },
  })

  // Check if we need to show the low stock warning
  const currentQuantity = form.watch('quantity')
  const reorderPoint = form.watch('reorderPoint')
  const showLowStockWarning = reorderPoint !== null && currentQuantity <= reorderPoint

  // Mutations for create/update
  const createInventoryMutation = api.inventory.create.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Inventory created successfully' })
      router.push(`/app/parts/${partId}?tab=details`)
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Failed to create inventory' })
      setIsLoading(false)
    },
  })

  const updateInventoryMutation = api.inventory.update.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Inventory updated successfully' })
      router.push(`/app/parts/${partId}?tab=details`)
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update inventory' })
      setIsLoading(false)
    },
  })

  // Handle form submission
  async function onSubmit(values) {
    setIsLoading(true)

    if (isEditing) {
      updateInventoryMutation.mutate({ id: inventoryId, ...values })
    } else {
      createInventoryMutation.mutate(values)
    }
  }

  const isPageLoading = isLoadingPart || (isEditing && isLoadingInventory && !initialData)

  return (
    <Card className='w-full max-w-3xl'>
      <CardHeader>
        <div className='mb-2 flex items-center'>
          <Button variant='ghost' size='icon' className='mr-2' onClick={() => router.back()}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <CardTitle>{isEditing ? 'Edit Inventory' : 'Add Inventory'}</CardTitle>
        </div>
        {part && (
          <CardDescription>
            {isEditing ? 'Update' : 'Set up'} inventory for: {part.title} ({part.sku})
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isPageLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='mr-2 h-8 w-8 animate-spin' />
            <span>Loading...</span>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
              {/* Current Quantity */}
              <FormField
                control={form.control}
                name='quantity'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <div className='flex items-center'>
                        <Package className='mr-2 h-4 w-4' />
                        Current Quantity
                      </div>
                    </FormLabel>
                    <FormControl>
                      <Input type='number' min='0' {...field} />
                    </FormControl>
                    <FormDescription>The current number of units in stock</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Location */}
              <FormField
                control={form.control}
                name='location'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <div className='flex items-center'>
                        <MapPin className='mr-2 h-4 w-4' />
                        Storage Location
                      </div>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder='e.g., Warehouse A, Shelf B3'
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormDescription>Where this part is physically stored</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <div className='mb-4 flex flex-col gap-1'>
                <h3 className='text-md font-medium'>Reordering Settings</h3>
                <p className='text-sm text-muted-foreground'>
                  Configure when and how much to reorder
                </p>
              </div>

              <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                {/* Reorder Point */}
                <FormField
                  control={form.control}
                  name='reorderPoint'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reorder Point</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min='0'
                          placeholder='Optional'
                          {...field}
                          value={field.value === null ? '' : field.value}
                          onChange={(e) => {
                            const value = e.target.value === '' ? null : parseInt(e.target.value)
                            field.onChange(value)
                          }}
                        />
                      </FormControl>
                      <FormDescription>Minimum stock level before reordering</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Reorder Quantity */}
                <FormField
                  control={form.control}
                  name='reorderQty'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reorder Quantity</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min='1'
                          placeholder='Optional'
                          {...field}
                          value={field.value === null ? '' : field.value}
                          onChange={(e) => {
                            const value = e.target.value === '' ? null : parseInt(e.target.value)
                            field.onChange(value)
                          }}
                        />
                      </FormControl>
                      <FormDescription>How many units to order when restocking</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Low stock warning */}
              {showLowStockWarning && (
                <div className='rounded-md border border-yellow-200 bg-yellow-50 p-4'>
                  <div className='flex'>
                    <div className='shrink-0'>
                      <AlertTriangle className='h-5 w-5 text-yellow-400' aria-hidden='true' />
                    </div>
                    <div className='ml-3'>
                      <h3 className='text-sm font-medium text-yellow-800'>Low Stock Alert</h3>
                      <div className='mt-2 text-sm text-yellow-700'>
                        <p>
                          Current quantity ({currentQuantity}) is at or below the reorder point (
                          {reorderPoint}). You may want to restock this item.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className='flex justify-end gap-4 pt-2'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => router.back()}
                  disabled={isLoading}>
                  Cancel
                </Button>
                <Button type='submit' disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {isEditing ? 'Updating...' : 'Creating...'}
                    </>
                  ) : (
                    <>
                      <RefreshCw className='mr-2 h-4 w-4' />
                      {isEditing ? 'Update Inventory' : 'Create Inventory'}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  )
}
