// apps/web/src/app/admin/workflows/[id]/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { IconPicker, type IconPickerValue } from '@auxx/ui/components/icon-picker'
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
import { ArrowLeft, Save, ScanSearch, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { use, useEffect, useState } from 'react'
import CodeEditor, { CodeLanguage } from '~/components/workflow/ui/code-editor'
import { api } from '~/trpc/react'

interface RequiredApp {
  appSlug: string
  appTitle: string
  blockIds: string[]
  triggerIds: string[]
  required: boolean
}

interface RequiredEntityConfig {
  entityTemplateId: string
  name: string
  apiSlug: string
  icon?: string
  color?: string
  fieldMapping: Record<string, string>
  requiredFields: string[]
  companionTemplateIds?: string[]
  required: boolean
}

/**
 * Extract required apps from a template graph by scanning for @slug:blockId patterns.
 */
function extractRequiredApps(graph: any): RequiredApp[] {
  if (!graph?.nodes || !Array.isArray(graph.nodes)) return []

  const appMap = new Map<string, { blockIds: Set<string>; triggerIds: Set<string> }>()

  for (const node of graph.nodes) {
    if (node.data?.appSlug) {
      const entry = appMap.get(node.data.appSlug) ?? {
        blockIds: new Set<string>(),
        triggerIds: new Set<string>(),
      }
      if (node.data.blockId) entry.blockIds.add(node.data.blockId)
      if (node.data.triggerId) entry.triggerIds.add(node.data.triggerId)
      appMap.set(node.data.appSlug, entry)
    }
  }

  return Array.from(appMap.entries()).map(([slug, { blockIds, triggerIds }]) => ({
    appSlug: slug,
    appTitle: slug, // Admin can edit this manually; will be resolved from cache on client
    blockIds: Array.from(blockIds),
    triggerIds: Array.from(triggerIds),
    required: true,
  }))
}

/**
 * Extract required entities from a template graph by scanning for @entity: and @field: refs.
 *
 * Note: entityTemplateId cannot be auto-determined from the graph alone (the graph uses apiSlug,
 * not the template ID). Set it manually in the JSON editor after scanning.
 * For system entities (contact, ticket, etc.) set entityTemplateId to "__system:<slug>".
 */
function extractRequiredEntitiesFromGraph(graph: any): RequiredEntityConfig[] {
  if (!graph?.nodes || !Array.isArray(graph.nodes)) return []

  const entityMap = new Map<string, Set<string>>()

  for (const node of graph.nodes) {
    if (node.data?.type !== 'crud' && node.data?.type !== 'find') continue

    const resourceType = node.data.resourceType as string
    if (!resourceType?.startsWith('@entity:')) continue

    const slug = resourceType.replace('@entity:', '')
    const fieldRefs = entityMap.get(slug) ?? new Set<string>()

    // CRUD nodes: field refs are keys in node.data.data
    if (node.data.data) {
      for (const key of Object.keys(node.data.data)) {
        if (key.startsWith('@field:')) {
          fieldRefs.add(key.replace('@field:', ''))
        }
      }
    }

    // Find nodes: field refs are in conditionGroups[].conditions[].fieldId
    if (node.data.conditionGroups && Array.isArray(node.data.conditionGroups)) {
      for (const group of node.data.conditionGroups) {
        if (!Array.isArray(group.conditions)) continue
        for (const condition of group.conditions) {
          if (typeof condition.fieldId === 'string' && condition.fieldId.startsWith('@field:')) {
            fieldRefs.add(condition.fieldId.replace('@field:', ''))
          }
        }
      }
    }

    entityMap.set(slug, fieldRefs)
  }

  return Array.from(entityMap.entries()).map(([slug, fieldRefs]) => ({
    // entityTemplateId must be set manually:
    // - system entities: "__system:<slug>" (e.g. "__system:contact")
    // - custom entities: template registry ID (e.g. "order", not "orders")
    entityTemplateId: '',
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    apiSlug: slug,
    fieldMapping: Object.fromEntries(Array.from(fieldRefs).map((ref) => [ref, ref])),
    requiredFields: Array.from(fieldRefs),
    required: true,
  }))
}

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
  const [iconValue, setIconValue] = useState<IconPickerValue>({ icon: 'zap', color: 'blue' })
  const [status, setStatus] = useState<'public' | 'private'>('private')
  const [popularity, setPopularity] = useState(0)
  const [graphJson, setGraphJson] = useState('{}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [requiredApps, setRequiredApps] = useState<RequiredApp[]>([])
  const [requiredEntities, setRequiredEntities] = useState<RequiredEntityConfig[]>([])
  const [requiredEntitiesJson, setRequiredEntitiesJson] = useState('[]')
  const [entitiesJsonError, setEntitiesJsonError] = useState<string | null>(null)
  const [envVarsJson, setEnvVarsJson] = useState('[]')
  const [envVarsError, setEnvVarsError] = useState<string | null>(null)

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
      if ((template as any).icon) {
        setIconValue({
          icon: (template as any).icon.iconId,
          color: (template as any).icon.color,
        })
      }
      setStatus(template.status as 'public' | 'private')
      setPopularity(template.popularity)
      setGraphJson(JSON.stringify(template.graph, null, 2))
      setRequiredApps((template as any).requiredApps ?? [])
      const entities = (template as any).requiredEntities ?? []
      setRequiredEntities(entities)
      setRequiredEntitiesJson(JSON.stringify(entities, null, 2))
      const envVars = (template as any).envVars ?? []
      setEnvVarsJson(JSON.stringify(envVars, null, 2))
    }
  }, [template])

  /** Known metadata keys that can be auto-filled from pasted JSON */
  const METADATA_KEYS = [
    'name',
    'description',
    'categories',
    'status',
    'popularity',
    'imgUrl',
    'icon',
  ]

  /**
   * Try to extract template metadata from JSON and auto-fill form fields.
   * Returns the graph-only JSON string if metadata was found, or null otherwise.
   */
  const tryExtractMetadata = (parsed: any): string | null => {
    if (typeof parsed !== 'object' || parsed === null) return null
    if (!('graph' in parsed) && !('nodes' in parsed)) return null
    if (!METADATA_KEYS.some((key) => key in parsed && parsed[key] !== undefined)) return null

    // Auto-fill form fields from metadata
    if (parsed.name) setName(parsed.name)
    if (parsed.description) setDescription(parsed.description)
    if (parsed.categories) {
      setCategories(
        Array.isArray(parsed.categories) ? parsed.categories.join(', ') : String(parsed.categories)
      )
    }
    if (parsed.imgUrl) setImgUrl(parsed.imgUrl)
    if (parsed.icon?.iconId && parsed.icon?.color) {
      setIconValue({ icon: parsed.icon.iconId, color: parsed.icon.color })
    }
    if (parsed.status === 'public' || parsed.status === 'private') setStatus(parsed.status)
    if (parsed.popularity !== undefined) setPopularity(Number(parsed.popularity) || 0)
    if (parsed.requiredApps && Array.isArray(parsed.requiredApps)) {
      setRequiredApps(parsed.requiredApps)
    }
    if (parsed.requiredEntities && Array.isArray(parsed.requiredEntities)) {
      setRequiredEntities(parsed.requiredEntities)
      setRequiredEntitiesJson(JSON.stringify(parsed.requiredEntities, null, 2))
    }
    if (parsed.envVars && Array.isArray(parsed.envVars)) {
      setEnvVarsJson(JSON.stringify(parsed.envVars, null, 2))
    }

    // Strip metadata, keep only the graph
    const graph = parsed.graph ?? {
      nodes: parsed.nodes,
      edges: parsed.edges,
      viewport: parsed.viewport,
    }
    return JSON.stringify(graph, null, 2)
  }

  /**
   * Handle graph JSON change with validation.
   * If the pasted JSON contains template metadata (name, description, etc.)
   * it auto-fills the form fields and strips the metadata, keeping only the graph.
   */
  const handleGraphChange = (value: string) => {
    try {
      const parsed = JSON.parse(value)
      setJsonError(null)

      const strippedGraph = tryExtractMetadata(parsed)
      setGraphJson(strippedGraph ?? value)
    } catch {
      setJsonError('Invalid JSON')
      setGraphJson(value)
    }
  }

  /**
   * Scan the graph JSON for app nodes and auto-populate requiredApps
   */
  const handleScanGraph = () => {
    try {
      const parsed = JSON.parse(graphJson)
      const scanned = extractRequiredApps(parsed)
      if (scanned.length === 0) {
        toastError({
          title: 'No app nodes found',
          description:
            'No nodes with appSlug were found in the graph. App nodes should have data.appSlug set.',
        })
        return
      }
      setRequiredApps(scanned)
    } catch {
      toastError({
        title: 'Invalid JSON',
        description: 'Fix the graph JSON before scanning',
      })
    }
  }

  /**
   * Scan the graph JSON for entity nodes and auto-populate requiredEntities
   */
  const handleScanEntities = () => {
    try {
      const parsed = JSON.parse(graphJson)
      const scanned = extractRequiredEntitiesFromGraph(parsed)
      if (scanned.length === 0) {
        toastError({
          title: 'No entity refs found',
          description:
            'No @entity: or @field: references found in CRUD/Find nodes. Use @entity:slug for resourceType and @field:name for field keys.',
        })
        return
      }
      // Merge with existing entries: the scan discovers which field refs exist in the graph
      // but cannot determine correct mapped values, required subsets, or metadata.
      // For any apiSlug already in the existing config, preserve all manually-set fields
      // and only add newly-discovered field refs (with 1:1 placeholder values).
      const existingBySlug = new Map(requiredEntities.map((e) => [e.apiSlug, e]))
      const merged = scanned.map((entry) => {
        const existing = existingBySlug.get(entry.apiSlug)
        if (!existing) return entry

        // fieldMapping: start with scanned (new refs as 1:1 placeholder),
        // then overlay existing (preserves correct templateFieldId/systemAttribute values
        // and retains any existing refs not referenced in the current graph)
        const mergedFieldMapping = { ...entry.fieldMapping, ...existing.fieldMapping }

        return {
          ...entry,
          entityTemplateId: existing.entityTemplateId || entry.entityTemplateId,
          name: existing.name || entry.name,
          icon: existing.icon ?? entry.icon,
          color: existing.color ?? entry.color,
          companionTemplateIds: existing.companionTemplateIds ?? entry.companionTemplateIds,
          required: existing.required,
          fieldMapping: mergedFieldMapping,
          requiredFields: existing.requiredFields,
        }
      })
      setRequiredEntities(merged)
      setRequiredEntitiesJson(JSON.stringify(merged, null, 2))
      setEntitiesJsonError(null)
    } catch {
      toastError({
        title: 'Invalid JSON',
        description: 'Fix the graph JSON before scanning',
      })
    }
  }

  /** Handle requiredEntities JSON editor change */
  const handleEntitiesJsonChange = (value: string) => {
    setRequiredEntitiesJson(value)
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        setEntitiesJsonError('Must be an array')
        return
      }
      setRequiredEntities(parsed)
      setEntitiesJsonError(null)
    } catch {
      setEntitiesJsonError('Invalid JSON')
    }
  }

  /** Handle envVars JSON editor change */
  const handleEnvVarsJsonChange = (value: string) => {
    setEnvVarsJson(value)
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        setEnvVarsError('Must be an array')
        return
      }
      setEnvVarsError(null)
    } catch {
      setEnvVarsError('Invalid JSON')
    }
  }

  /** Remove a required app entry */
  const handleRemoveRequiredApp = (index: number) => {
    setRequiredApps((prev) => prev.filter((_, i) => i !== index))
  }

  /** Toggle required flag for an app */
  const handleToggleRequired = (index: number) => {
    setRequiredApps((prev) =>
      prev.map((app, i) => (i === index ? { ...app, required: !app.required } : app))
    )
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

    const iconData = { iconId: iconValue.icon, color: iconValue.color }

    let parsedEnvVars: any[] = []
    try {
      parsedEnvVars = JSON.parse(envVarsJson)
    } catch {
      toastError({
        title: 'Invalid JSON',
        description: 'Please fix the envVars JSON before saving',
      })
      return
    }

    if (isNew) {
      await createTemplate.mutateAsync({
        name,
        description,
        categories: categoriesArray,
        imgUrl: imgUrl || undefined,
        icon: iconData,
        status,
        popularity,
        graph: parsedGraph,
        requiredApps,
        requiredEntities: requiredEntities.length > 0 ? requiredEntities : undefined,
        envVars: parsedEnvVars.length > 0 ? parsedEnvVars : undefined,
      })
    } else {
      await updateTemplate.mutateAsync({
        id,
        name,
        description,
        categories: categoriesArray,
        imgUrl: imgUrl || undefined,
        icon: iconData,
        status,
        popularity,
        graph: parsedGraph,
        requiredApps,
        requiredEntities: requiredEntities.length > 0 ? requiredEntities : undefined,
        envVars: parsedEnvVars,
      })
    }
  }

  const isSaving = createTemplate.isPending || updateTemplate.isPending
  const canSave =
    name.trim() && description.trim() && !jsonError && !entitiesJsonError && !envVarsError

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
        <div className='flex-1 overflow-auto flex flex-col'>
          <div className='grid grid-cols-2 flex-1 '>
            {/* Left Column - Form Fields */}
            <div className='space-y-6 overflow-y-auto p-6'>
              {/* Name & Icon */}
              <div className='space-y-2'>
                <Label htmlFor='name'>Template Name</Label>
                <div className='flex items-center gap-2'>
                  <IconPicker value={iconValue} onChange={setIconValue} className='size-8' />
                  <Input
                    id='name'
                    className='flex-1'
                    placeholder='e.g., Order Status Inquiry Handler'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
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

              {/* Required Apps */}
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label>Required Apps</Label>
                  <Button variant='outline' size='sm' onClick={handleScanGraph}>
                    <ScanSearch />
                    Scan Graph
                  </Button>
                </div>
                {requiredApps.length > 0 ? (
                  <div className='space-y-2'>
                    {requiredApps.map((app, index) => (
                      <div
                        key={app.appSlug}
                        className='flex items-center justify-between rounded-lg border p-2'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>{app.appSlug}</span>
                          {app.blockIds.length > 0 && (
                            <Badge variant='secondary' className='text-xs'>
                              {app.blockIds.length} block{app.blockIds.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                          {app.triggerIds.length > 0 && (
                            <Badge variant='secondary' className='text-xs'>
                              {app.triggerIds.length} trigger
                              {app.triggerIds.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                          <Badge
                            variant={app.required ? 'default' : 'outline'}
                            className='text-xs cursor-pointer'
                            onClick={() => handleToggleRequired(index)}>
                            {app.required ? 'Required' : 'Optional'}
                          </Badge>
                        </div>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => handleRemoveRequiredApp(index)}>
                          <Trash2 className='size-3' />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    No required apps. Click "Scan Graph" to detect app nodes.
                  </p>
                )}
              </div>

              {/* Required Entities */}
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label>Required Entities</Label>
                  <Button variant='outline' size='sm' onClick={handleScanEntities}>
                    <ScanSearch />
                    Scan Entities
                  </Button>
                </div>
                {requiredEntities.length > 0 ? (
                  <div className='space-y-2'>
                    <div className='space-y-1'>
                      {requiredEntities.map((entity, index) => (
                        <div
                          key={entity.apiSlug || entity.entityTemplateId || index}
                          className='flex items-center justify-between rounded-lg border p-2'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-medium'>
                              {entity.name ||
                                entity.apiSlug ||
                                entity.entityTemplateId ||
                                '(unset)'}
                            </span>
                            {entity.apiSlug && (
                              <span className='text-xs text-muted-foreground font-mono'>
                                {entity.entityTemplateId || '⚠ no templateId'}
                              </span>
                            )}
                            <Badge variant='secondary' className='text-xs'>
                              {Object.keys(entity.fieldMapping).length} field
                              {Object.keys(entity.fieldMapping).length !== 1 ? 's' : ''}
                            </Badge>
                            <Badge
                              variant={entity.required ? 'default' : 'outline'}
                              className='text-xs'>
                              {entity.required ? 'Required' : 'Optional'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                    <CodeEditor
                      value={requiredEntitiesJson}
                      onChange={handleEntitiesJsonChange}
                      language={CodeLanguage.json}
                      title='Required Entities'
                      minHeight={200}
                      enableWorkflowCompletions={false}
                    />
                    {entitiesJsonError && (
                      <span className='text-xs text-destructive'>{entitiesJsonError}</span>
                    )}
                  </div>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    No required entities. Click "Scan Entities" to detect @entity: and @field: refs
                    in CRUD/Find nodes.
                  </p>
                )}
              </div>

              {/* Environment Variables */}
              <div className='space-y-2'>
                <Label>Environment Variables</Label>
                <p className='text-xs text-muted-foreground'>
                  Declare env vars copied to the workflow on creation. Use{' '}
                  <code className='font-mono'>{'{{env.VAR_NAME}}'}</code> to reference them in
                  nodes. IDs must be <code className='font-mono'>env.VAR_NAME</code>. Set{' '}
                  <code className='font-mono'>value: ""</code> for secrets.
                </p>
                <CodeEditor
                  value={envVarsJson}
                  onChange={handleEnvVarsJsonChange}
                  language={CodeLanguage.json}
                  title='envVars JSON'
                  minHeight={150}
                  enableWorkflowCompletions={false}
                />
                {envVarsError && <span className='text-xs text-destructive'>{envVarsError}</span>}
              </div>
            </div>

            {/* Right Column - Graph JSON Editor */}
            <div className='h-full flex-1 flex'>
              <div className='flex flex-col space-y-2 flex-1 ps-0 p-6'>
                <div className='flex items-center justify-between'>
                  <Label>Workflow Graph</Label>
                  {jsonError && <span className='text-xs text-destructive'>{jsonError}</span>}
                </div>
                <CodeEditor
                  className='flex-1'
                  value={graphJson}
                  onChange={handleGraphChange}
                  language={CodeLanguage.json}
                  title='Graph JSON'
                  minHeight={600}
                  enableWorkflowCompletions={false}
                />
              </div>
            </div>
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
