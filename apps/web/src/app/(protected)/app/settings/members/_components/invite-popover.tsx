'use client'
import { type ReactNode, useState } from 'react'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { OrganizationRole } from '@auxx/database/enums'
const formSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address.' }),
  role: z.enum(OrganizationRole, { error: 'Please select a valid role.' }),
})
interface InviteFormProps {
  children?: ReactNode
}
export default function InviteFormPopover({ children }: InviteFormProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { email: '', role: OrganizationRole.USER },
  })
  const inviteUser = api.member.invite.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Invitation sent',
        description: 'The user has been invited to your organization.',
      })
      form.reset()
      setIsOpen(false)
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
      setIsSubmitting(false)
    },
  })
  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true)
    try {
      await inviteUser.mutateAsync({ email: values.email, role: values.role })
      setIsSubmitting(false)
    } catch (error) {
      // Error is handled in the mutation callbacks
    }
  }
  const defaultTrigger = (
    <Button variant="outline" size="icon">
      <Plus className="h-4 w-4" />
      <span className="sr-only">Invite Team Member</span>
    </Button>
  )
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children || defaultTrigger}</PopoverTrigger>
      <PopoverContent className="w-80" side="bottom" align="end">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Invite Team Members</h4>
            <p className="text-sm text-muted-foreground">Add people to your organization</p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="colleague@example.com" {...field} />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Enter the email address of the person you want to invite.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={OrganizationRole.ADMIN}>Admin</SelectItem>
                        <SelectItem value={OrganizationRole.USER}>User</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      Admins can manage the organization and invite others.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending...' : 'Send Invitation'}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </PopoverContent>
    </Popover>
  )
}
