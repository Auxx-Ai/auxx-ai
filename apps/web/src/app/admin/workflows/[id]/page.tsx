// apps/web/src/app/admin/workflows/[id]/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { ArrowLeft, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { use, useEffect, useState } from 'react'
import CodeEditor from '~/components/workflow/ui/structured-output-generator/code-editor'
import { api } from '~/trpc/react'

/**
 * Workflow template editor page
 * Allows super admins to edit template metadata and workflow graph
 */
export default function WorkflowTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const isNew = id === 'new'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categories, setCategories] = useState('')
  const [imgUrl, setImgUrl] = useState('')
  const [status, setStatus] = useState<'public' | 'private'>('private')
  const [popularity, setPopularity] = useState(0)
  const [graphJson, setGraphJson] = useState('{}')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const { data: template, isLoading } = api.admin.workflowTemplates.getById.useQuery(
    { id },
    { enabled: !isNew }
  )

  const utils = api.useUtils()

  const createTemplate = api.admin.workflowTemplates.create.useMutation({
    onSuccess: (data) => {
      utils.admin.workflowTemplates.getAll.invalidate()
      router.push(`/admin/workflows/${data.id}`)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create template',
        description: error.message,
      })
    },
  })

  const updateTemplate = api.admin.workflowTemplates.update.useMutation({
    onSuccess: () => {
      utils.admin.workflowTemplates.getAll.invalidate()
      utils.admin.workflowTemplates.getById.invalidate({ id })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update template',
        description: error.message,
      })
    },
  })

  /**
   * Load template data into form
   */
  useEffect(() => {
    if (template) {
      setName(template.name)
      setDescription(template.description)
      setCategories((template.categories as string[]).join(', '))
      setImgUrl(template.imgUrl || '')
      setStatus(template.status as 'public' | 'private')
      setPopularity(template.popularity)
      setGraphJson(JSON.stringify(template.graph, null, 2))
    }
  }, [template])

  /**
   * Handle graph JSON change with validation
   */
  const handleGraphChange = (value: string) => {
    setGraphJson(value)
    try {
      JSON.parse(value)
      setJsonError(null)
    } catch (error) {
      setJsonError('Invalid JSON')
    }
  }

  /**
   * Handle save template
   */
  const handleSave = async () => {
    const categoriesArray = categories
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)

    let parsedGraph
    try {
      parsedGraph = JSON.parse(graphJson)
    } catch (error) {
      toastError({
        title: 'Invalid JSON',
        description: 'Please fix the graph JSON before saving',
      })
      return
    }

    if (isNew) {
      await createTemplate.mutateAsync({
        name,
        description,
        categories: categoriesArray,
        imgUrl: imgUrl || undefined,
        status,
        popularity,
        graph: parsedGraph,
      })
    } else {
      await updateTemplate.mutateAsync({
        id,
        name,
        description,
        categories: categoriesArray,
        imgUrl: imgUrl || undefined,
        status,
        popularity,
        graph: parsedGraph,
      })
    }
  }

  const isSaving = createTemplate.isPending || updateTemplate.isPending
  const canSave = name.trim() && description.trim() && !jsonError

  if (isLoading) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Workflow Templates' href='/admin/workflows' />
            <MainPageBreadcrumbItem title='Loading...' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='space-y-6 max-w-2xl'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-32 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex gap-2'>
            <Button variant='outline' size='sm' onClick={() => router.back()}>
              <ArrowLeft />
              Back
            </Button>
            <Button
              size='sm'
              onClick={handleSave}
              disabled={!canSave}
              loading={isSaving}
              loadingText='Saving...'>
              <Save />
              Save
            </Button>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Admin' href='/admin' />
          <MainPageBreadcrumbItem title='Workflow Templates' href='/admin/workflows' />
          <MainPageBreadcrumbItem title={isNew ? 'New Template' : template?.name || 'Edit'} last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='grid grid-cols-2 flex-1'>
          {/* Left Column - Form Fields */}
          <div className='space-y-6 overflow-y-auto p-6'>
            {/* Name */}
            <div className='space-y-2'>
              <Label htmlFor='name'>Template Name</Label>
              <Input
                id='name'
                placeholder='e.g., Order Status Inquiry Handler'
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className='space-y-2'>
              <Label htmlFor='description'>Description</Label>
              <Textarea
                id='description'
                placeholder='Describe what this template does...'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>

            {/* Categories */}
            <div className='space-y-2'>
              <Label htmlFor='categories'>Categories</Label>
              <Input
                id='categories'
                placeholder='e.g., customer-service, shopify (comma-separated)'
                value={categories}
                onChange={(e) => setCategories(e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>
                Separate multiple categories with commas
              </p>
            </div>

            {/* Image URL */}
            <div className='space-y-2'>
              <Label htmlFor='imgUrl'>Preview Image URL</Label>
              <Input
                id='imgUrl'
                placeholder='https://example.com/image.png'
                value={imgUrl}
                onChange={(e) => setImgUrl(e.target.value)}
              />
            </div>

            {/* Status */}
            <div className='space-y-2'>
              <Label htmlFor='status'>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'public' | 'private')}>
                <SelectTrigger id='status'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='private'>Private (Hidden from users)</SelectItem>
                  <SelectItem value='public'>Public (Visible to all users)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Popularity */}
            <div className='space-y-2'>
              <Label htmlFor='popularity'>Popularity Score</Label>
              <Input
                id='popularity'
                type='number'
                min='0'
                value={popularity}
                onChange={(e) => setPopularity(parseInt(e.target.value, 10) || 0)}
              />
              <p className='text-xs text-muted-foreground'>
                Higher scores appear first in template lists
              </p>
            </div>
          </div>

          {/* Right Column - Graph JSON Editor */}
          <div className='h-full flex-1 flex'>
            <div className='flex flex-col space-y-2 flex-1 ps-0 p-6'>
              <div className='flex items-center justify-between'>
                <Label>Workflow Graph</Label>
                {jsonError && <span className='text-xs text-destructive'>{jsonError}</span>}
              </div>
              <div className='flex-1 border rounded-md overflow-hidden'>
                <CodeEditor
                  value={graphJson}
                  onUpdate={handleGraphChange}
                  showFormatButton={true}
                  hideTopMenu={false}
                  editorWrapperClassName='h-full'
                  className='h-full'
                />
              </div>
            </div>
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
