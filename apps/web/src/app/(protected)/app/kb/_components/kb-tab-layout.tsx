// src/app/(protected)/app/kb/_components/kb-tab-layout.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
// DND Kit imports for drag and drop functionality
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { GripVertical, PlusCircle, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api, type RouterOutputs } from '~/trpc/react'

type KBType = RouterOutputs['kb']['byId'] // Or adjust if using a combined type

// Define the navigation item schema
const navigationItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  link: z.string().min(1, 'Link is required'),
})

// Define the layout schema with navigation arrays
const layoutSchema = z.object({
  searchbarPosition: z.enum(['center', 'corner']).default('center'),
  headerEnabled: z.boolean().default(true),
  footerEnabled: z.boolean().default(true),
  headerNavigation: z.array(navigationItemSchema).default([]),
  footerNavigation: z.array(navigationItemSchema).default([]),
})

export type LayoutFormValues = z.infer<typeof layoutSchema>

// SortableItem component for drag-and-drop navigation items
interface SortableItemProps {
  id: string
  index: number
  item: { title: string; link: string }
  onRemove: () => void
  onChange: (field: 'title' | 'link', value: string) => void
  disabled: boolean
}

function SortableItem({ id, item, onRemove, onChange, disabled }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className='mb-2 flex items-center space-x-2 rounded-md border bg-background p-2'>
      <div {...attributes} {...listeners} className='cursor-grab'>
        <GripVertical className='h-5 w-5 text-muted-foreground' />
      </div>

      <div className='grid flex-1 grid-cols-2 gap-2'>
        <Input
          value={item.title}
          onChange={(e) => onChange('title', e.target.value)}
          placeholder='Menu title'
          className='w-full'
          disabled={disabled}
        />
        <Input
          value={item.link}
          onChange={(e) => onChange('link', e.target.value)}
          placeholder='/url-path or https://...'
          className='w-full'
          disabled={disabled}
        />
      </div>

      <Button type='button' variant='ghost' size='icon' onClick={onRemove} disabled={disabled}>
        <Trash2 className='h-4 w-4 text-destructive' />
      </Button>
    </div>
  )
}

// Navigation Manager component for header or footer
interface NavigationManagerProps {
  type: 'header' | 'footer'
  value: Array<{ title: string; link: string }>
  onChange: (items: Array<{ title: string; link: string }>) => void
  disabled: boolean
}

function NavigationManager({ type, value, onChange, disabled }: NavigationManagerProps) {
  const items = value || []
  const itemIds = items.map((_, index) => `${type}-item-${index}`)

  // Set up DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Handle drag end event
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = itemIds.indexOf(active.id as string)
      const newIndex = itemIds.indexOf(over.id as string)

      // Create a new array with the item moved to the new position
      const newItems = [...items]
      const [movedItem] = newItems.splice(oldIndex, 1)
      newItems.splice(newIndex, 0, movedItem)

      onChange(newItems)
    }
  }

  // Handle adding a new item
  const handleAddItem = () => {
    onChange([...items, { title: '', link: '' }])
  }

  // Handle removing an item
  const handleRemoveItem = (index: number) => {
    const newItems = [...items]
    newItems.splice(index, 1)
    onChange(newItems)
  }

  // Handle changing an item's value
  const handleChangeItem = (index: number, field: 'title' | 'link', value: string) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    onChange(newItems)
  }

  return (
    <div className='space-y-4'>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className='space-y-2'>
            {items.map((item, index) => (
              <SortableItem
                key={itemIds[index]}
                id={itemIds[index]}
                index={index}
                item={item}
                onRemove={() => handleRemoveItem(index)}
                onChange={(field, value) => handleChangeItem(index, field, value)}
                disabled={disabled}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={handleAddItem}
        disabled={disabled}
        className='w-full'>
        <PlusCircle className='mr-2 h-4 w-4' />
        Add Navigation Item
      </Button>
    </div>
  )
}

export interface KBTabLayoutRef {
  submitForm: () => Promise<void> // Or return whatever your mutation returns/needs
}

type LayoutTabProps = { knowledgeBaseId?: string; knowledgeBase: KBType }

function KBTabLayout({ knowledgeBaseId, knowledgeBase }: LayoutTabProps) {
  // Update mutation

  // useKnowledgeBase({ knowledgeBaseId })

  const updateKnowledgeBase = api.kb.update.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Layout settings updated successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Failed to update layout settings', description: error.message })
    },
  })
  // Form instance
  const form = useForm<LayoutFormValues>({
    resolver: standardSchemaResolver(layoutSchema),
    defaultValues: {
      searchbarPosition: 'center',
      headerEnabled: true,
      footerEnabled: true,
      headerNavigation: [],
      footerNavigation: [],
    },
  })

  // Populate form when data is loaded
  useEffect(() => {
    if (knowledgeBase) {
      // Parse header and footer navigation from JSON
      const headerNavigation = knowledgeBase.headerNavigation ? knowledgeBase.headerNavigation : []

      const footerNavigation = knowledgeBase.footerNavigation ? knowledgeBase.footerNavigation : []

      // Reset form with existing data
      form.reset({
        searchbarPosition: (knowledgeBase.searchbarPosition as any) || 'center',
        headerEnabled: headerNavigation.length > 0,
        footerEnabled: footerNavigation.length > 0,
        headerNavigation,
        footerNavigation,
      })
    }
  }, [knowledgeBase, form])

  // Form submission handler
  async function onSubmit(data: LayoutFormValues) {
    if (!knowledgeBaseId) return

    // Only include navigations in the update if they are enabled
    const updateData = {
      searchbarPosition: data.searchbarPosition,
      headerNavigation: data.headerEnabled ? data.headerNavigation : [],
      footerNavigation: data.footerEnabled ? data.footerNavigation : [],
    }

    await updateKnowledgeBase.mutateAsync({
      id: knowledgeBaseId,
      data: updateData,
    })
  }

  // Note: useImperativeHandle removed for React 19 compatibility
  // Methods can be accessed directly from the component instance if needed

  // if (isLoading) {
  //   return (
  //     <div className='flex h-full items-center justify-center p-8'>
  //       <Loader2 className='h-8 w-8 animate-spin text-primary' />
  //     </div>
  //   )
  // }

  return (
    <div className='p-4 pb-16'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
          <Card className='shadow-none'>
            <CardHeader className='border-b py-4'>
              <CardTitle className='flex items-center justify-between gap-2 font-normal'>
                <div>Header</div>
                <FormField
                  control={form.control}
                  name='headerEnabled'
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={updateKnowledgeBase.isPending}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className='group/panel-body group-data-[variant=opened]/panel:bg-base group-data-[variant=opened]/panel:group-data-[kind=danger]/panel:border-danger flex flex-col gap-6 p-4 group-data-[variant=opened]/panel:rounded-lg group-data-[variant=opened]/panel:border'>
              <FormField
                control={form.control}
                name='searchbarPosition'
                render={({ field }) => (
                  <FormItem className='group/actionable-container flex grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] flex-col gap-x-4 gap-y-2'>
                    <div className='space-y-0.5'>
                      <FormLabel className='text-base'>Search bar</FormLabel>
                      <FormDescription>
                        Pick the style of the search bar. On small screens it's displayed as an icon
                        button.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={updateKnowledgeBase.isPending}>
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Pick...' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Position</SelectLabel>
                            <SelectItem value='center'>Center</SelectItem>
                            <SelectItem value='corner'>Corner</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='headerNavigation'
                render={({ field }) => (
                  <FormItem className='group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2'>
                    <FormLabel>Navigation</FormLabel>
                    <FormDescription>
                      Configure the navigation menu items for the header. You can rearrange them by
                      dragging.
                    </FormDescription>

                    <FormControl>
                      <NavigationManager
                        type='header'
                        value={field.value}
                        onChange={field.onChange}
                        disabled={!form.watch('headerEnabled') || updateKnowledgeBase.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className='shadow-none'>
            <CardHeader className='border-b py-4'>
              <CardTitle className='flex items-center justify-between gap-2 font-normal'>
                <div>Footer</div>
                <FormField
                  control={form.control}
                  name='footerEnabled'
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={updateKnowledgeBase.isPending}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className='group/panel-body group-data-[variant=opened]/panel:bg-base group-data-[variant=opened]/panel:group-data-[kind=danger]/panel:border-danger flex flex-col gap-6 p-4 group-data-[variant=opened]/panel:rounded-lg group-data-[variant=opened]/panel:border'>
              <FormField
                control={form.control}
                name='footerNavigation'
                render={({ field }) => (
                  <FormItem className='group/actionable-container flex min-w-0 flex-1 flex-col gap-x-4 gap-y-2'>
                    <FormLabel>Footer Navigation</FormLabel>
                    <FormDescription>
                      Configure the navigation menu items for the footer. You can rearrange them by
                      dragging.
                    </FormDescription>

                    <FormControl>
                      <NavigationManager
                        type='footer'
                        value={field.value}
                        onChange={field.onChange}
                        disabled={!form.watch('footerEnabled') || updateKnowledgeBase.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  )
}

export default KBTabLayout
