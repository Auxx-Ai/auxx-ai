// apps/web/src/app/(protected)/app/tickets/settings/templates/_components/template-list.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent } from '@auxx/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Switch } from '@auxx/ui/components/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { formatDistance } from 'date-fns'
import {
  EyeIcon,
  LoaderIcon,
  MailIcon,
  MoreHorizontal,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { TemplateEditorDialog } from './template-editor-dialog'
import TemplatePreview from './template-preview'

/** Map template type to human readable name */
const getTemplateTypeName = (type: string) => {
  switch (type) {
    case 'TICKET_CREATED':
      return 'Ticket Created'
    case 'TICKET_REPLIED':
      return 'Ticket Reply'
    case 'TICKET_CLOSED':
      return 'Ticket Closed'
    case 'TICKET_REOPENED':
      return 'Ticket Reopened'
    case 'TICKET_ASSIGNED':
      return 'Ticket Assigned'
    case 'TICKET_STATUS_CHANGED':
      return 'Status Changed'
    case 'CUSTOM':
      return 'Custom Template'
    default:
      return type
  }
}

/** Email templates list component */
export function EmailTemplatesList() {
  const [isCreating, setIsCreating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<any>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const { data: templatesData, isLoading, refetch } = api.emailTemplate.getTemplates.useQuery()

  const updateTemplate = api.emailTemplate.updateTemplate.useMutation({
    onSuccess: () => refetch(),
    onError: (error) => {
      toastError({ title: 'Error updating template', description: error.message })
    },
  })

  const deleteTemplate = api.emailTemplate.deleteTemplate.useMutation({
    onSuccess: () => refetch(),
    onError: (error) => {
      toastError({ title: 'Error deleting template', description: error.message })
    },
  })

  const previewTemplate = api.emailTemplate.previewTemplate.useMutation({
    onSuccess: (data) => {
      setPreviewData(data.preview)
      setIsPreviewing(true)
    },
    onError: (error) => {
      toastError({ title: 'Error generating preview', description: error.message })
    },
  })

  /** Handle toggling template active status */
  const handleToggleActive = async (templateId: string, isActive: boolean) => {
    await updateTemplate.mutateAsync({ id: templateId, isActive })
  }

  /** Handle deleting a template */
  const handleDeleteTemplate = async (templateId: string) => {
    const confirmed = await confirm({
      title: 'Delete template?',
      description: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await deleteTemplate.mutateAsync({ id: templateId })
    }
  }

  /** Handle editing a template */
  const handleEditTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId)
    setIsEditing(true)
  }

  /** Handle previewing a template */
  const handlePreviewTemplate = async (templateId: string) => {
    setSelectedTemplateId(templateId)
    await previewTemplate.mutateAsync({ templateId })
  }

  return (
    <div className='container mx-auto'>
      <ConfirmDialog />

      <div className='mb-6 hidden sm:flex items-center justify-end'>
        <Button onClick={() => setIsCreating(true)} size='sm'>
          <PlusIcon />
          New Template
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className='py-10 text-center'>
            <div className='flex justify-center'>
              <LoaderIcon className='h-8 w-8 animate-spin text-muted-foreground' />
            </div>
            <p className='mt-4 text-muted-foreground'>Loading templates...</p>
          </CardContent>
        </Card>
      ) : templatesData?.templates && templatesData.templates.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className='w-[50px]'></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templatesData.templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className='font-medium'>{template.name}</TableCell>
                <TableCell>{getTemplateTypeName(template.type)}</TableCell>
                <TableCell className='max-w-xs truncate'>{template.subject}</TableCell>
                <TableCell>
                  {formatDistance(new Date(template.updatedAt), new Date(), {
                    addSuffix: true,
                  })}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={template.isActive}
                    onCheckedChange={(checked) => handleToggleActive(template.id, checked)}
                  />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='icon-sm'>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onClick={() => handlePreviewTemplate(template.id)}>
                        <EyeIcon />
                        Preview
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEditTemplate(template.id)}>
                        <PencilIcon />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeleteTemplate(template.id)}
                        variant='destructive'>
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Card>
          <CardContent className='py-10 text-center'>
            <MailIcon className='mx-auto mb-4 h-12 w-12 text-muted-foreground' />
            <h3 className='mb-2 text-lg font-medium'>No Email Templates</h3>
            <p className='mb-4 text-muted-foreground'>
              You don't have any email templates yet. Create your first template.
            </p>
            <Button onClick={() => setIsCreating(true)}>Create Template</Button>
          </CardContent>
        </Card>
      )}

      {/* Mobile: fixed full-width button at bottom */}
      <div className='fixed bottom-3 left-3 right-3 z-40 p-4 sm:hidden'>
        <Button onClick={() => setIsCreating(true)} className='w-full'>
          <PlusIcon />
          New Template
        </Button>
      </div>

      {/* Template Editor Dialog (Create/Edit) */}
      <TemplateEditorDialog
        open={isCreating || isEditing}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreating(false)
            setIsEditing(false)
            setSelectedTemplateId(null)
          }
        }}
        templateId={isEditing ? selectedTemplateId : null}
        onSave={refetch}
      />

      {/* Preview Template Dialog */}
      <Dialog open={isPreviewing} onOpenChange={setIsPreviewing}>
        <DialogContent size='xxl' position='tc'>
          <DialogHeader>
            <DialogTitle>Template Preview</DialogTitle>
            <DialogDescription>Preview how this template will look when sent</DialogDescription>
          </DialogHeader>
          {previewData && <TemplatePreview preview={previewData} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
