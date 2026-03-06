// apps/web/src/app/admin/developer-accounts/_components/import-apps-dialog.tsx
'use client'

import type { ImportResult, ImportValidation } from '@auxx/lib/admin'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { AlertCircle, CheckCircle2, FileUp, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { api } from '~/trpc/react'

type Step = 'upload' | 'preview' | 'result'

interface ImportAppsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetDeveloperAccountId: string
  onImportComplete: () => void
}

function getStatusBadge(status: 'new' | 'update' | 'conflict') {
  switch (status) {
    case 'new':
      return <Badge variant='default'>New</Badge>
    case 'update':
      return <Badge variant='secondary'>Update</Badge>
    case 'conflict':
      return <Badge variant='destructive'>Conflict</Badge>
  }
}

/**
 * Multi-step dialog for importing apps from an export JSON file.
 * Steps: upload → preview & configure → result
 */
export function ImportAppsDialog({
  open,
  onOpenChange,
  targetDeveloperAccountId,
  onImportComplete,
}: ImportAppsDialogProps) {
  const [step, setStep] = useState<Step>('upload')
  const [exportData, setExportData] = useState<unknown>(null)
  const [validation, setValidation] = useState<ImportValidation | null>(null)
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const [slugOverrides, setSlugOverrides] = useState<Record<string, string>>({})
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateImport = api.admin.apps.validateImport.useMutation()
  const importApps = api.admin.apps.importApps.useMutation()

  const reset = useCallback(() => {
    setStep('upload')
    setExportData(null)
    setValidation(null)
    setSelectedSlugs(new Set())
    setSlugOverrides({})
    setImportResult(null)
    setParseError(null)
    setIsDragging(false)
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  const processFile = async (file: File) => {
    setParseError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      // Basic structure check before sending to server
      if (!data.exportVersion || !data.developerAccount || !Array.isArray(data.apps)) {
        setParseError(
          'Invalid export file: missing required fields (exportVersion, developerAccount, apps)'
        )
        return
      }

      setExportData(data)

      const result = await validateImport.mutateAsync({
        exportData: data,
        targetDeveloperAccountId,
      })
      setValidation(result)

      // Select all non-conflict apps by default
      const defaultSelected = new Set(
        result.apps.filter((a) => a.status !== 'conflict').map((a) => a.slug)
      )
      setSelectedSlugs(defaultSelected)
      setStep('preview')
    } catch (err) {
      if (err instanceof SyntaxError) {
        setParseError('Invalid JSON file')
      } else {
        setParseError(err instanceof Error ? err.message : 'Failed to validate import file')
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/json') {
      processFile(file)
    } else {
      setParseError('Please drop a .json file')
    }
  }

  const toggleSlug = (slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })
  }

  const updateSlugOverride = (originalSlug: string, newSlug: string) => {
    setSlugOverrides((prev) => {
      if (newSlug === originalSlug || newSlug === '') {
        const { [originalSlug]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [originalSlug]: newSlug }
    })
  }

  const hasConflictSelected = validation?.apps.some(
    (app) => app.status === 'conflict' && selectedSlugs.has(app.slug) && !slugOverrides[app.slug]
  )

  const handleImport = async () => {
    if (!exportData || !validation) return

    try {
      const result = await importApps.mutateAsync({
        exportData: exportData as never,
        targetDeveloperAccountId,
        selectedSlugs: Array.from(selectedSlugs),
        slugOverrides,
      })
      setImportResult(result)
      setStep('result')
      onImportComplete()
    } catch (err) {
      toastError({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size='lg'>
        {step === 'upload' && (
          <>
            <DialogHeader>
              <DialogTitle>Import Apps</DialogTitle>
              <DialogDescription>
                Upload an export JSON file to import apps into this environment.
              </DialogDescription>
            </DialogHeader>

            <div
              className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}>
              <FileUp className='h-10 w-10 text-muted-foreground' />
              <div className='text-sm text-muted-foreground'>
                Drag and drop a JSON file here, or click to browse
              </div>
              <Button
                variant='outline'
                size='sm'
                loading={validateImport.isPending}
                onClick={() => fileInputRef.current?.click()}>
                <Upload />
                Choose File
              </Button>
              <input
                ref={fileInputRef}
                type='file'
                accept='.json'
                className='hidden'
                onChange={handleFileSelect}
              />
            </div>

            {parseError && (
              <div className='flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive'>
                <AlertCircle className='h-4 w-4 shrink-0' />
                {parseError}
              </div>
            )}

            <DialogFooter>
              <Button variant='outline' onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'preview' && validation && (
          <>
            <DialogHeader>
              <DialogTitle>Preview Import</DialogTitle>
              <DialogDescription>
                Developer account: <strong>@{validation.developerAccount.slug}</strong>
                {' — '}
                {validation.developerAccount.exists ? 'will be updated' : 'will be created'}
              </DialogDescription>
            </DialogHeader>

            <div className='max-h-[400px] overflow-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-10' />
                    <TableHead>App</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-center'>Connections</TableHead>
                    <TableHead className='text-center'>OAuth</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validation.apps.map((app) => {
                    const isSelected = selectedSlugs.has(app.slug)
                    const hasOverride = !!slugOverrides[app.slug]
                    const isConflict = app.status === 'conflict'

                    return (
                      <TableRow
                        key={app.slug}
                        className={isConflict && !hasOverride ? 'bg-destructive/5' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSlug(app.slug)}
                          />
                        </TableCell>
                        <TableCell className='font-medium text-sm'>{app.title}</TableCell>
                        <TableCell>
                          {isConflict && isSelected ? (
                            <Input
                              size='sm'
                              defaultValue={app.slug}
                              placeholder='Enter new slug'
                              className={!hasOverride ? 'border-destructive' : ''}
                              onChange={(e) => updateSlugOverride(app.slug, e.target.value)}
                            />
                          ) : (
                            <span className='text-sm text-muted-foreground'>@{app.slug}</span>
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(app.status)}</TableCell>
                        <TableCell className='text-center text-sm'>{app.connectionCount}</TableCell>
                        <TableCell className='text-center text-sm'>
                          {app.hasOauth ? 'Yes' : 'No'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <div className='space-y-1 text-sm text-muted-foreground'>
              <div>
                Importing {selectedSlugs.size} of {validation.apps.length} apps
              </div>
              <div>
                All apps will be imported as unpublished. Secrets must be configured manually.
              </div>
            </div>

            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => {
                  reset()
                  setStep('upload')
                }}>
                Back
              </Button>
              <Button
                loading={importApps.isPending}
                loadingText='Importing...'
                disabled={selectedSlugs.size === 0 || !!hasConflictSelected}
                onClick={handleImport}>
                Import
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'result' && importResult && (
          <>
            <DialogHeader>
              <DialogTitle>Import Complete</DialogTitle>
              <DialogDescription>
                Developer account <strong>@{importResult.developerAccount.slug}</strong>{' '}
                {importResult.developerAccount.action}.
              </DialogDescription>
            </DialogHeader>

            <div className='max-h-[300px] overflow-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>OAuth</TableHead>
                    <TableHead>Connections</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importResult.apps.map((app) => (
                    <TableRow key={app.slug} className='h-12'>
                      <TableCell>
                        <div className='text-sm font-medium'>
                          @{app.slug}
                          {app.originalSlug && (
                            <span className='ml-1 text-xs text-muted-foreground'>
                              (was @{app.originalSlug})
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={app.action === 'created' ? 'default' : 'secondary'}>
                          {app.action}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-sm'>
                        {app.oauthApplication ? (
                          `${app.oauthApplication.action}`
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='text-sm'>{app.connectionDefinitions.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {importResult.postImportChecklist.length > 0 && (
              <div className='space-y-2'>
                <div className='text-sm font-medium'>Post-Import Checklist</div>
                <ul className='space-y-1 text-sm text-muted-foreground'>
                  {importResult.postImportChecklist.map((item) => (
                    <li key={item} className='flex items-start gap-2'>
                      <CheckCircle2 className='mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
