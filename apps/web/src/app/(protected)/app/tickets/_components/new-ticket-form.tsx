// components/tickets/new-ticket-form.tsx
'use client'
import { useState } from 'react'
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
// Type-specific form components
// import { ReturnForm } from './ticket-forms/return-form'
// import { ProductIssueForm } from './ticket-forms/product-issue-form'
// import { BillingForm } from './ticket-forms/billing-form'
// import { TechnicalForm } from './ticket-forms/technical-form'
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
interface NewTicketFormProps {
  onSuccess?: () => void
}
// export const TicketTypeIcons = {
//   [TicketType.GENERAL]: <Book size={16} />,
//   [TicketType.MISSING_ITEM]: <BookX size={16} />,
//   [TicketType.RETURN]: <CornerDownLeft size={16} />,
//   [TicketType.PRODUCT_ISSUE]: <BadgeAlert size={16} />,
//   [TicketType.SHIPPING_ISSUE]: <Truck size={16} />,
//   [TicketType.REFUND]: <TicketX size={16} />,
//   [TicketType.BILLING]: <Receipt size={16} />,
//   [TicketType.TECHNICAL]: <MemoryStick size={16} />,
//   [TicketType.OTHER]: <HelpCircle size={16} />,
// }
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
export default function NewTicketForm({ onSuccess }: NewTicketFormProps) {
  const [currentType, setCurrentType] = useState<TicketType>(TicketType.GENERAL)
  // Unified state for type-specific data
  const [typeData, setTypeData] = useState<Record<string, any>>({})
  // Helper function to update type data
  const updateTypeData = (updates: Record<string, any>) => {
    setTypeData((prev) => ({ ...prev, ...updates }))
  }
  // Queries to get options
  // const { data: customersData, isLoading: customersLoading } =
  //   api.customer.all.useQuery({})
  const { data: agents, isLoading: agentsLoading } = api.ticketAgent.getAvailableAgents.useQuery()
  const { data: tickets, isLoading: ticketsLoading } = api.ticket.all.useQuery({ limit: 100 })
  // const customers = customersData?.customers || []
  // Create ticket mutation
  const createTicketMutation = api.ticket.create.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Ticket created successfully',
        description: 'The new support ticket has been created.',
      })
      if (onSuccess) {
        onSuccess()
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to create ticket', description: error.message })
    },
  })
  // Form definition
  const form = useForm<z.infer<typeof baseFormSchema> & any>({
    resolver: standardSchemaResolver(baseFormSchema),
    defaultValues: {
      title: '',
      description: '',
      type: TicketType.GENERAL,
      priority: TicketPriority.MEDIUM,
      contactId: '',
      assignedToId: '',
    },
  })
  // Watch for changes to ticket type
  const watchType = form.watch('type')
  if (watchType !== currentType) {
    setCurrentType(watchType)
  }
  // Form submission
  const onSubmit = async (data: z.infer<typeof baseFormSchema> & any) => {
    // Prepare type-specific data based on ticket type
    let finalTypeData = {}
    switch (data.type) {
      case TicketType.MISSING_ITEM:
        finalTypeData = {
          orderId: typeData.orderId,
          orderDate: typeData.orderDate,
          missingItems:
            typeData.missingItems?.map((item: any) => ({
              ...item,
              quantity: parseInt(item.quantity, 10),
            })) || [],
          replacementSent: typeData.replacementSent || false,
        }
        break
      case TicketType.SHIPPING_ISSUE:
        finalTypeData = {
          orderId: typeData.orderId || data.orderId,
          orderDate: typeData.orderDate || data.orderDate,
          trackingNumber: typeData.trackingNumber || data.trackingNumber,
          carrier: typeData.carrier || data.carrier,
          issue: typeData.issue || data.issue,
        }
        break
      case TicketType.REFUND:
        finalTypeData = {
          orderId: typeData.orderId || data.orderId,
          orderDate: typeData.orderDate || data.orderDate,
          refundAmount: typeData.refundAmount ? parseFloat(typeData.refundAmount) : undefined,
          refundReason: typeData.refundReason || data.refundReason,
          refundStatus: typeData.refundStatus || 'PENDING',
        }
        break
      case TicketType.RETURN:
        finalTypeData = {
          orderId: typeData.orderId,
          orderDate: typeData.orderDate,
          returnItems:
            typeData.returnItems?.map((item: any) => ({
              ...item,
              quantity: parseInt(item.quantity, 10),
            })) || [],
          returnReason: typeData.returnReason,
          returnStatus: typeData.returnStatus || 'REQUESTED',
          returnLabelSent: typeData.returnLabelSent || false,
          returnTrackingNumber: typeData.returnTrackingNumber,
        }
        break
      case TicketType.PRODUCT_ISSUE:
        finalTypeData = {
          productId: typeData.productId || data.productId,
          purchaseDate: typeData.purchaseDate || data.purchaseDate,
          orderId: typeData.orderId || data.orderId,
          issueDescription: typeData.issueDescription || data.issueDescription,
          productImages: typeData.productImages || data.productImages || [],
        }
        break
      case TicketType.BILLING:
        finalTypeData = {
          invoiceId: typeData.invoiceId || data.invoiceId,
          invoiceDate: typeData.invoiceDate || data.invoiceDate,
          billingIssue: typeData.billingIssue || data.billingIssue,
          amountDisputed: typeData.amountDisputed ? parseFloat(typeData.amountDisputed) : undefined,
        }
        break
      case TicketType.TECHNICAL:
        finalTypeData = {
          deviceInfo: typeData.deviceInfo || data.deviceInfo,
          browserInfo: typeData.browserInfo || data.browserInfo,
          errorMessage: typeData.errorMessage || data.errorMessage,
          stepsToReproduce: typeData.stepsToReproduce || data.stepsToReproduce,
        }
        break
      default:
        finalTypeData = {}
    }
    // Submit with the new simplified structure
    const ticketData = {
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      contactId: data.contactId,
      assignedToId: data.assignedToId || undefined,
      dueDate: data.dueDate,
      parentTicketId: data.parentTicketId || undefined,
      typeData: finalTypeData,
      typeStatus: typeData.status,
    }
    // Submit the data
    createTicketMutation.mutate(ticketData)
  }
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
                        className={`w-full pl-3 text-left font-normal ${!field.value ? 'text-muted-foreground' : ''}`}>
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
                      tickets?.tickets.map((ticket) => (
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
            <h3 className="mb-4 text-lg font-medium">{currentType.replace(/_/g, ' ')} Details</h3>

            {/* Type-specific forms */}
            {currentType === TicketType.MISSING_ITEM && (
              <MissingItemForm form={form} typeData={typeData} setTypeData={updateTypeData} />
            )}

            {currentType === TicketType.SHIPPING_ISSUE && (
              <ShippingIssueForm form={form} typeData={typeData} setTypeData={updateTypeData} />
            )}

            {currentType === TicketType.REFUND && (
              <RefundForm form={form} typeData={typeData} setTypeData={updateTypeData} />
            )}

            {currentType === TicketType.RETURN && (
              <ReturnForm form={form} typeData={typeData} setTypeData={updateTypeData} />
            )}

            {currentType === TicketType.PRODUCT_ISSUE && (
              <ProductIssueForm form={form} typeData={typeData} setTypeData={updateTypeData} />
            )}

            {/* {currentType === TicketType.BILLING && <BillingForm form={form} />} */}

            {/* {currentType === TicketType.TECHNICAL && (
              <TechnicalForm form={form} />
            )} */}
          </div>
        )}
        <div className="flex items-center justify-end">
          <Button
            type="submit"
            variant="outline"
            loading={createTicketMutation.isPending}
            loadingText="Creating...">
            Create Ticket
          </Button>
        </div>
      </form>
    </Form>
  )
}
