'use client'

// apps/web/src/app/(protected)/app/tickets/_components/dialog-mass-priority.tsx

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Form,
  FormControl,
  FormDescription,
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
import { api } from '~/trpc/react'

// Supported ticket priorities presented in the selector
const ticketPriorityOptions = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

// Validation schema enforcing a valid ticket priority selection
const massPrioritySchema = z.object({
  priority: z.enum(ticketPriorityOptions),
})

// Strongly typed shape for the mass priority form values
type MassPriorityFormValues = z.infer<typeof massPrioritySchema>

// Props describing the state and handlers for the mass priority dialog
interface MassPriorityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketIds: string[]
  onSuccess: () => void
}

// Allows users to update priority on multiple tickets with validation and feedback
export function MassPriorityDialog({
  open,
  onOpenChange,
  ticketIds,
  onSuccess,
}: MassPriorityDialogProps) {
  const form = useForm<MassPriorityFormValues>({
    resolver: zodResolver(massPrioritySchema),
    defaultValues: { priority: undefined } as Partial<MassPriorityFormValues>,
  })

  const updatePriority = api.ticket.updateMultiplePriority.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `Successfully updated ${ticketIds.length} ticket(s) priority` })
      form.reset()
      onSuccess()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ description: `Error: ${error.message}` })
    },
  })

  // Handles submission by invoking the mutation with a validated priority
  const onSubmit = async (values: MassPriorityFormValues) => {
    await updatePriority.mutateAsync({ ticketIds, priority: values.priority })
  }

  const disableActions = updatePriority.isPending
  const selectedPriority = form.watch('priority')
  const disableSubmit = disableActions || !selectedPriority

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>Update Ticket Priority</DialogTitle>
          <DialogDescription>
            Change the priority for {ticketIds.length} selected ticket(s).
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Priority</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={disableActions}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a new priority" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ticketPriorityOptions.map((priorityOption) => (
                        <SelectItem key={priorityOption} value={priorityOption}>
                          {priorityOption}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Updating the priority helps keep your queue organized.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={disableActions}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="submit"
                disabled={disableSubmit}
                loading={disableActions}
                loadingText="Updating...">
                Update Priority
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
