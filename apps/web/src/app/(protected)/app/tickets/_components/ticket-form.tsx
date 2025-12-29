// components/tickets/ticket-form.tsx
'use client'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Calendar } from '@auxx/ui/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { CalendarIcon, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { MissingItemForm } from './missing-item-form'
import { ShippingIssueForm } from './shipping-issue-form'
import { RefundForm } from './refund-form'
import { ReturnForm } from './return-form'
import { ProductIssueForm } from './product-issue-form'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import CustomerSelect from '~/components/global/select-customer'
import { TicketPriorityColors, TicketTypeIcons } from '~/components/tickets/shared'
import { TicketType, TicketPriority } from '@auxx/database/enums'
// Base form schema
const baseFormSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  description: z.string().optional(),
  type: z.enum(TicketType),
  priority: z.enum(TicketPriority).default(TicketPriority.MEDIUM),
  contactId: z.string().min(1, 'Customer is required'),
  assignedToId: z.string().optional(),
  dueDate: z.date().optional(),
  parentTicketId: z.string().optional(),
})
interface TicketFormProps {
  ticket?: any // The existing ticket for editing
  onSuccess?: () => void
  isEditing?: boolean
  onClose?: (ticket: any) => Promise<void>
  contactId?: string
}
function StatusDot({ className }: { className?: string }) {
  return (
    <svg
      width="8"
      height="8"
      fill="currentColor"
      viewBox="0 0 8 8"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true">
      <circle cx="4" cy="4" r="4" />
    </svg>
  )
}
export default function TicketForm({
  ticket,
  onSuccess,
  isEditing = false,
  onClose,
  contactId,
}: TicketFormProps) {
  const utils = api.useUtils()
  const [currentType, setCurrentType] = useState<TicketType>(ticket?.type || TicketType.GENERAL)
  // State for type-specific data with default values or those from the existing ticket
  const [missingItemData, setMissingItemData] = useState<any>({
    orderId: ticket?.missingItemCase?.orderId || '',
    orderDate: ticket?.missingItemCase?.orderDate,
    missingItems:
      ticket?.missingItemCase?.missingItems?.length > 0
        ? ticket.missingItemCase.missingItems
        : [{ name: '', quantity: 1, sku: '' }],
  })
  const [returnData, setReturnData] = useState<any>({
    orderId: ticket?.returnCase?.orderId || '',
    orderDate: ticket?.returnCase?.orderDate,
    returnItems:
      ticket?.returnCase?.returnItems?.length > 0
        ? ticket.returnCase.returnItems
        : [{ name: '', quantity: 1, sku: '', reason: '' }],
    returnReason: ticket?.returnCase?.returnReason || '',
  })
  // Queries to get options
  const { data: agents, isLoading: agentsLoading } = api.ticketAgent.getAvailableAgents.useQuery()
  const { data: tickets, isLoading: ticketsLoading } = api.ticket.all.useQuery({ limit: 100 })
  // Create or update ticket mutations
  const createTicket = api.ticket.create.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Ticket created successfully',
        description: 'The new support ticket has been created.',
      })
      if (onSuccess) {
        onSuccess()
      }
      utils.ticket.invalidate() // Invalidate ticket cache to refresh data
    },
    onError: (error) => {
      toastError({ title: 'Failed to create ticket', description: error.message })
    },
  })
  const updateTicket = api.ticket.update.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Ticket updated successfully',
        description: 'The support ticket has been updated.',
      })
      if (onSuccess) {
        onSuccess()
      }
      utils.ticket.invalidate() // Invalidate ticket cache to refresh data
    },
    onError: (error) => {
      toastError({ title: 'Failed to update ticket', description: error.message })
    },
  })
  // Form definition
  const form = useForm<z.infer<typeof baseFormSchema> & any>({
    resolver: standardSchemaResolver(baseFormSchema),
    defaultValues: {
      title: ticket?.title || '',
      description: ticket?.description || '',
      type: ticket?.type || TicketType.GENERAL,
      priority: ticket?.priority || TicketPriority.MEDIUM,
      contactId: contactId || ticket?.contactId || '',
      assignedToId: ticket?.assignedTo || '',
      dueDate: ticket?.dueDate ? new Date(ticket?.dueDate) : undefined,
      parentTicketId: ticket?.parentTicketId || '',
    },
  })
  // Set form values when ticket data is available for editing
  useEffect(() => {
    if (ticket && isEditing) {
      console.log(ticket.type)
      form.reset({
        title: ticket.title || '',
        description: ticket.description || '',
        type: ticket.type || TicketType.GENERAL,
        priority: ticket.priority || TicketPriority.MEDIUM,
        contactId: contactId || ticket.contactId || '',
        assignedToId: ticket.assignedToId || '',
        dueDate: ticket.dueDate ? new Date(ticket.dueDate) : undefined,
        parentTicketId: ticket.parentTicketId || '',
        // Set type-specific form values based on ticket type
        ...(ticket.type === TicketType.SHIPPING_ISSUE &&
          ticket.shippingIssueCase && {
            orderId: ticket.shippingIssueCase.orderId,
            orderDate: ticket.shippingIssueCase.orderDate
              ? new Date(ticket.shippingIssueCase.orderDate)
              : undefined,
            trackingNumber: ticket.shippingIssueCase.trackingNumber,
            carrier: ticket.shippingIssueCase.carrier,
            issue: ticket.shippingIssueCase.issue,
          }),
        ...(ticket.type === TicketType.REFUND &&
          ticket.refundCase && {
            orderId: ticket.refundCase.orderId,
            orderDate: ticket.refundCase.orderDate
              ? new Date(ticket.refundCase.orderDate)
              : undefined,
            refundAmount: ticket.refundCase.refundAmount?.toString(),
            refundReason: ticket.refundCase.refundReason,
          }),
        ...(ticket.type === TicketType.PRODUCT_ISSUE &&
          ticket.productIssueCase && {
            productId: ticket.productIssueCase.productId,
            purchaseDate: ticket.productIssueCase.purchaseDate
              ? new Date(ticket.productIssueCase.purchaseDate)
              : undefined,
            orderId: ticket.productIssueCase.orderId,
            issueDescription: ticket.productIssueCase.issueDescription,
            productImages: ticket.productIssueCase.productImages || [],
          }),
      })
      // Set current type to match the existing ticket
      setCurrentType(ticket.type)
    }
  }, [ticket, isEditing, form])
  // Watch for changes to ticket type
  const watchType = form.watch('type')
  if (watchType !== currentType) {
    setCurrentType(watchType)
  }
  // Form submission
  const onSubmit = async (data: z.infer<typeof baseFormSchema> & any) => {
    // Prepare type-specific data
    let typeSpecificData = {}
    switch (data.type) {
      case TicketType.MISSING_ITEM:
        typeSpecificData = {
          missingItemCase: {
            orderId: missingItemData.orderId,
            orderDate: missingItemData.orderDate,
            missingItems: missingItemData.missingItems.map((item: any) => ({
              ...item,
              quantity: parseInt(item.quantity, 10),
            })),
          },
        }
        break
      case TicketType.SHIPPING_ISSUE:
        typeSpecificData = {
          shippingIssueCase: {
            orderId: data.orderId,
            orderDate: data.orderDate,
            trackingNumber: data.trackingNumber,
            carrier: data.carrier,
            issue: data.issue,
          },
        }
        break
      case TicketType.REFUND:
        typeSpecificData = {
          refundCase: {
            orderId: data.orderId,
            orderDate: data.orderDate,
            refundAmount: parseFloat(data.refundAmount),
            refundReason: data.refundReason,
          },
        }
        break
      case TicketType.RETURN:
        typeSpecificData = {
          returnCase: {
            orderId: returnData.orderId,
            orderDate: returnData.orderDate,
            returnItems: returnData.returnItems.map((item: any) => ({
              ...item,
              quantity: parseInt(item.quantity, 10),
            })),
            returnReason: returnData.returnReason,
          },
        }
        break
      case TicketType.PRODUCT_ISSUE:
        typeSpecificData = {
          productIssueCase: {
            productId: data.productId,
            purchaseDate: data.purchaseDate,
            orderId: data.orderId,
            issueDescription: data.issueDescription,
            productImages: data.productImages || [],
          },
        }
        break
      case TicketType.BILLING:
        typeSpecificData = {
          billingCase: {
            invoiceId: data.invoiceId,
            invoiceDate: data.invoiceDate,
            billingIssue: data.billingIssue,
            amountDisputed: data.amountDisputed ? parseFloat(data.amountDisputed) : undefined,
          },
        }
        break
      case TicketType.TECHNICAL:
        typeSpecificData = {
          technicalCase: {
            deviceInfo: data.deviceInfo,
            browserInfo: data.browserInfo,
            errorMessage: data.errorMessage,
            stepsToReproduce: data.stepsToReproduce,
          },
        }
        break
    }
    // Combine base data with type-specific data
    const ticketData = {
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      contactId: data.contactId,
      assignedToId: data.assignedToId || undefined,
      dueDate: data.dueDate,
      parentTicketId: data.parentTicketId || undefined,
      ...typeSpecificData,
    }
    // Submit the data - either create or update
    if (isEditing && ticket) {
      updateTicket.mutate({ id: ticket.id, ...ticketData })
    } else {
      const result = await createTicket.mutateAsync(ticketData)
      if (onClose) {
        onClose(result)
      }
    }
  }
  const isPending = createTicket.isPending || updateTicket.isPending
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input placeholder="Ticket title" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="[&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span_svg]:shrink-0 [&>span_svg]:text-muted-foreground/80">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="[&_*[role=option]>span>svg]:shrink-0 [&_*[role=option]>span>svg]:text-muted-foreground/80 [&_*[role=option]>span]:flex [&_*[role=option]>span]:gap-2">
                    {Object.values(TicketType).map((type) => (
                      <SelectItem key={type} value={type}>
                        {TicketTypeIcons[type]}
                        <span className="truncate">{type.replace(/_/g, ' ')}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Detailed description of the issue"
                  className="min-h-[100px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <CustomerSelect
            name="contactId"
            label="Customer"
            placeholder="Search for a customer..."
            description="Select the customer who needs support"
            defaultValue={ticket?.contactId ? ticket.contactId.toString() : null}
            required
          />

          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="[&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span_svg]:shrink-0">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="[&_*[role=option]>span>svg]:shrink-0 [&_*[role=option]>span>svg]:text-muted-foreground/80 [&_*[role=option]>span]:end-2 [&_*[role=option]>span]:start-auto [&_*[role=option]>span]:flex [&_*[role=option]>span]:items-center [&_*[role=option]>span]:gap-2 [&_*[role=option]]:pe-8 [&_*[role=option]]:ps-2">
                    {Object.values(TicketPriority).map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        <span className="flex items-center gap-2">
                          <StatusDot className={TicketPriorityColors[priority]} />
                          <span className="truncate">{priority}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="assignedToId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Assign To</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {agentsLoading ? (
                      <SelectItem value="loading" disabled>
                        Loading agents...
                      </SelectItem>
                    ) : (
                      agents?.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Due Date (Optional)</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        className={`w-full pl-3 text-left font-normal focus-visible:ring-1 focus-visible:ring-blue-500 ${!field.value ? 'text-muted-foreground' : ''}`}>
                        {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="parentTicketId"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Parent Ticket (Optional)</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="No parent ticket" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="no-parents">No parent ticket</SelectItem>
                    {ticketsLoading ? (
                      <SelectItem value="loading" disabled>
                        Loading tickets...
                      </SelectItem>
                    ) : (
                      tickets?.tickets
                        .filter((t) => t.id !== ticket?.id) // Don't show current ticket as parent option
                        .map((ticket) => (
                          <SelectItem key={ticket.id} value={ticket.id}>
                            #{ticket.id.substring(0, 8)} - {ticket.title}
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Conditional form sections based on ticket type */}
        {currentType !== TicketType.GENERAL && (
          <div className="rounded-md border p-4">
            <h3 className="mb-4 text-lg font-medium">
              {(currentType + '').replace(/_/g, ' ')} Details
            </h3>

            {/* Type-specific forms */}
            {currentType === TicketType.MISSING_ITEM && (
              <MissingItemForm form={form} data={missingItemData} setData={setMissingItemData} />
            )}

            {currentType === TicketType.SHIPPING_ISSUE && <ShippingIssueForm form={form} />}

            {currentType === TicketType.REFUND && <RefundForm form={form} />}

            {currentType === TicketType.RETURN && (
              <ReturnForm form={form} data={returnData} setData={setReturnData} />
            )}

            {currentType === TicketType.PRODUCT_ISSUE && <ProductIssueForm form={form} />}

            {/* Add other type-specific forms when implemented */}
          </div>
        )}
        <div className="flex items-center justify-end space-x-2">
          <Button type="submit" loading={isPending} loadingText="Saving..." variant="outline">
            {isEditing ? 'Update Ticket' : 'Create Ticket'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
