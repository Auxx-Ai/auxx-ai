// ~/components/customers/customer-info-card.tsx
'use client'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Edit,
  Mail,
  Phone,
  Save,
  Tag,
  Trash,
  User,
  Calendar,
  User2,
  Notebook,
} from 'lucide-react'
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
import { Badge } from '@auxx/ui/components/badge'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { CustomerStatus } from '@auxx/database/enums'
interface CustomerInfoCardProps {
  customer: any // Replace with proper type
  isMerged: boolean
  refetch: () => void
}
export default function CustomerInfoCard({ customer, isMerged, refetch }: CustomerInfoCardProps) {
  // State for edit mode
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    email: customer.email || '',
    phone: customer.phone || '',
    notes: customer.notes || '',
    status: customer.status as CustomerStatus,
  })
  // Mutations
  const updateCustomerMutation = api.contact.update.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Customer updated',
        description: 'Customer information has been updated successfully',
      })
      setIsEditing(false)
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Error updating customer', description: error.message })
    },
  })
  // Handle edit mode
  const startEditing = () => {
    setFormData({
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      email: customer.email || '',
      phone: customer.phone || '',
      notes: customer.notes || '',
      status: customer.status,
    })
    setIsEditing(true)
  }
  const cancelEditing = () => {
    setIsEditing(false)
  }

  const saveChanges = async () => {
    await updateCustomerMutation.mutateAsync({ id: customer.id, ...formData })
  }

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }
  const customerName =
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unnamed Customer'
  return (
    <div>
      <div className="border-dark flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <User2 className="text-muted-foreground/70" size={20} aria-hidden="true" />
          <h2 className="text-sm font-medium">Customer Information</h2>
        </div>
        <div>
          {!isEditing && !isMerged ? (
            <Button variant="ghost" size="sm" onClick={startEditing} className="h-8 w-8 p-0">
              <Edit />
            </Button>
          ) : isEditing ? (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={cancelEditing} className="h-8 w-8 p-0">
                <Trash />
              </Button>
              <Button variant="ghost" size="sm" onClick={saveChanges} className="h-8 w-8 p-0">
                <Save />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {isEditing ? (
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              type="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" value={formData.phone} onChange={handleInputChange} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, status: value as CustomerStatus }))
              }>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="SPAM">Spam</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              rows={3}
            />
          </div>
        </div>
      ) : (
        <div className="pt-2">
          <div className="relative mb-[2px] flex items-center">
            <div className="flex-[0 0 36%] me-2 flex">
              <button
                className="bg-primary-50 text-primary-500 flex h-[30px] w-full items-center rounded-[5px] px-[6px] text-left text-sm hover:bg-slate-100"
                title="Customer"
                aria-label="Customer">
                <User className="mr-2 size-4 text-muted-foreground" />
                Name
              </button>
            </div>
            <div className="relative flex flex-1 rounded-[5px] px-[10px] hover:bg-slate-100">
              <button className="flex min-h-[30px] flex-1 items-center p-0">
                <div className="inline overflow-hidden whitespace-nowrap text-sm">
                  {customerName}
                </div>
              </button>
            </div>
          </div>
          <div className="relative mb-[2px] flex items-center">
            <div className="flex-[0 0 36%] me-2 flex">
              <button
                className="bg-primary-50 text-primary-500 flex h-[30px] w-full items-center rounded-[5px] px-[6px] text-left text-sm hover:bg-slate-100"
                title="Customer"
                aria-label="Customer">
                <Mail className="mr-2 h-4 w-4 text-muted-foreground" />
                Email
              </button>
            </div>
            <div className="relative flex flex-1 rounded-[5px] px-[10px] hover:bg-slate-100">
              <button className="flex min-h-[30px] flex-1 items-center p-0">
                <div className="inline overflow-hidden whitespace-nowrap text-sm">
                  {customer.email}
                </div>
              </button>
            </div>
          </div>
          <div className="relative mb-[2px] flex items-center">
            <div className="flex-[0 0 36%] me-2 flex">
              <button
                className="bg-primary-50 text-primary-500 flex h-[30px] w-full items-center rounded-[5px] px-[6px] text-left text-sm hover:bg-slate-100"
                title="Customer"
                aria-label="Customer">
                <Phone className="mr-2 h-4 w-4 text-muted-foreground" />
                Phone
              </button>
            </div>
            <div className="relative flex flex-1 rounded-[5px] px-[10px] hover:bg-slate-100">
              <button className="flex min-h-[30px] flex-1 items-center p-0">
                <div className="inline overflow-hidden whitespace-nowrap text-sm">
                  {customer.phone}
                </div>
              </button>
            </div>
          </div>
          <div className="relative mb-[2px] flex items-center">
            <div className="flex-[0 0 36%] me-2 flex">
              <button
                className="bg-primary-50 text-primary-500 flex h-[30px] w-full items-center rounded-[5px] px-[6px] text-left text-sm hover:bg-slate-100"
                title="Customer"
                aria-label="Customer">
                <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                Added
              </button>
            </div>
            <div className="relative flex flex-1 rounded-[5px] px-[10px] hover:bg-slate-100">
              <button className="flex min-h-[30px] flex-1 items-center p-0">
                <div className="inline overflow-hidden whitespace-nowrap text-sm">
                  {formatDistanceToNow(new Date(customer.createdAt), { addSuffix: true })}
                </div>
              </button>
            </div>
          </div>

          <div className="relative mb-[2px] flex items-center">
            <div className="flex-[0 0 36%] me-2 flex">
              <button
                className="bg-primary-50 text-primary-500 flex h-[30px] w-full items-center rounded-[5px] px-[6px] text-left text-sm hover:bg-slate-100"
                title="Customer"
                aria-label="Customer">
                <Notebook className="mr-2 h-4 w-4 text-muted-foreground" />
                Notes
              </button>
            </div>
            <div className="relative flex flex-1 rounded-[5px] px-[10px] hover:bg-slate-100">
              <button className="flex min-h-[30px] flex-1 items-center p-0">
                <div className="inline overflow-hidden whitespace-nowrap text-sm">
                  {customer.notes}
                </div>
              </button>
            </div>
          </div>

          {customer.tags && customer.tags.length > 0 && (
            <div className="border-t pt-2">
              <h4 className="mb-1 flex items-center text-sm font-medium">
                <Tag className="mr-1 h-4 w-4" /> Tags
              </h4>
              <div className="mt-1 flex flex-wrap gap-1">
                {customer.tags.map((tag: string, i: number) => (
                  <Badge key={i} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
