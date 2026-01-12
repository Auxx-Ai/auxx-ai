'use client'

// ~/app/(protected)/app/contacts/_components/new-customer-form.tsx
import { useState } from 'react'
import { useContactMutations } from './use-contact-mutations'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import PhoneInputWithFlag from '@auxx/ui/components/phone-input'

/**
 * Props accepted by the new customer dialog component.
 */
interface NewCustomerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

/**
 * Renders the new customer dialog with form controls and submission handling.
 */
export default function NewCustomerForm({ open, onOpenChange, onSuccess }: NewCustomerFormProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
    sourceType: 'MANUAL' as 'EMAIL' | 'TICKET_SYSTEM' | 'SHOPIFY' | 'MANUAL' | 'OTHER',
  })

  const mutations = useContactMutations({
    onSuccess: () => {
      resetForm()
      onSuccess()
      onOpenChange(false)
    },
  })

  /**
   * Updates form state when a standard input, textarea, or select value changes.
   */
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  /**
   * Synchronizes phone input value from the flag selector component into local state.
   */
  const handlePhoneChange = (value: string) => {
    console.log(value)
    setFormData((prev) => ({ ...prev, phone: value }))
  }

  /**
   * Restores the form to its initial state when the dialog closes.
   */
  const resetForm = () => {
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: '',
      sourceType: 'MANUAL',
    })
  }

  /**
   * Validates required fields and triggers the create customer mutation.
   */
  const handleCreateCustomer = () => {
    if (!formData.email) {
      toastError({
        title: 'Email required',
        description: 'Please enter an email address for the customer',
      })
      return
    }

    mutations.createContact.mutate(formData)
  }

  // Register Meta+Enter submit handler
  useDialogSubmit({
    onSubmit: handleCreateCustomer,
    disabled: !formData.email || mutations.createContact.isPending,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" position="tc">
        <DialogHeader>
          <DialogTitle>Create New Customer</DialogTitle>
          <DialogDescription>Add a new customer to your database.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Input
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                placeholder="First Name (required)"
              />
            </div>
            <div className="space-y-2">
              <Input
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                placeholder="Last Name (required)"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="Email address (required)"
              required
            />
          </div>

          <div className="space-y-2">
            <PhoneInputWithFlag
              value={formData.phone}
              onChange={handlePhoneChange}
              countryClassName="bg-primary-50"
              className={`h-8 border border-primary-200 focus:border-primary-300 bg-primary-50 dark:bg-primary-100 focus:ring-primary-400 placeholder:text-primary-500   [&>input]:flex-1 [&>input]:outline-none [&>input]:focus:ring-0`}
            />
          </div>

          <div className="space-y-2">
            <Select
              value={formData.sourceType}
              onValueChange={(value) =>
                setFormData((prev) => ({
                  ...prev,
                  sourceType: value as 'EMAIL' | 'TICKET_SYSTEM' | 'SHOPIFY' | 'MANUAL' | 'OTHER',
                }))
              }>
              <SelectTrigger>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Manual Entry</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="TICKET_SYSTEM">Ticket System</SelectItem>
                <SelectItem value="SHOPIFY">Shopify</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              rows={3}
              placeholder="Notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            disabled={mutations.createContact.isPending}
            onClick={() => {
              resetForm()
              onOpenChange(false)
            }}>
            Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
          </Button>
          <Button
            onClick={handleCreateCustomer}
            size="sm"
            disabled={!formData.email || mutations.createContact.isPending}
            loading={mutations.createContact.isPending}
            loadingText="Creating..."
            variant="outline">
            Create Customer <KbdSubmit variant="outline" size="sm" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
