// apps/web/src/app/(protected)/app/examples/file-upload/page.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Separator } from '@auxx/ui/components/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import React, { useState } from 'react'
import { FileSelect, FileSelectDialog, type FileSelectItem } from '~/components/file-select'
import {
  type BatchUploadResult,
  FileItem,
  type FileItemProps,
  FileQueueManager,
} from '~/components/file-upload'
import { type FileSelection, FilesPicker } from '~/components/pickers'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'

/**
 * Minimal FileItem - Simplified compact display
 */
function MinimalFileItem({ fileId, ...props }: FileItemProps) {
  return (
    <div className='bg-gray-50 border-l-4 border-gray-400 pl-4 py-2'>
      <FileItem fileId={fileId} compact={true} {...props} />
    </div>
  )
}

/**
 * Basic Upload Example Component
 */
function BasicUploadExample({
  onComplete,
  onError,
  onProgress,
}: {
  onComplete: (results: BatchUploadResult) => void
  onError: (error: string) => void
  onProgress: (progress: BatchUploadResult) => void
}) {
  return (
    <div className='space-y-3'>
      <div className='p-3 bg-blue-50 border border-blue-200 rounded-lg'>
        <p className='text-sm text-blue-700'>
          <strong>Enhanced Features:</strong> Direct presigned uploads to storage, real-time
          progress tracking, per-file cancellation, advanced queue controls, retry logic, and live
          connection status.
        </p>
      </div>
      <FileQueueManager
        entityType='article:attachment'
        // Note: entityId is optional - omitting it will create generic upload session
        onComplete={onComplete}
        onError={onError}
        onProgress={onProgress}
        showDropZone={true}
        showControls={true}
        showProgress={true}
        maxFiles={5}
      />
    </div>
  )
}

/**
 * Minimal Upload Example Component
 */
function MinimalUploadExample({
  onComplete,
  onError,
}: {
  onComplete: (results: BatchUploadResult) => void
  onError: (error: string) => void
}) {
  return (
    <FileQueueManager
      entityType='article:attachment'
      onComplete={onComplete}
      onError={onError}
      fileItemComponent={MinimalFileItem}
      showHeader={false}
      showDropZone={true}
      compact={true}
      maxFiles={10}
    />
  )
}

/**
 * FileSelect Component Example
 */
function FileSelectExample() {
  const [multipleFiles, setMultipleFiles] = useState<FileSelectItem[]>([])
  const [singleFile, setSingleFile] = useState<FileSelectItem[]>([])
  const [compactFiles, setCompactFiles] = useState<FileSelectItem[]>([])

  const handleFilesChange = (files: FileSelectItem[]) => {
    console.log('FileSelect - Multiple files changed:', files)
    setMultipleFiles(files)
  }

  const handleSingleFileChange = (files: FileSelectItem[]) => {
    console.log('FileSelect - Single file changed:', files)
    setSingleFile(files)
  }

  const handleCompactFilesChange = (files: FileSelectItem[]) => {
    console.log('FileSelect - Compact files changed:', files)
    setCompactFiles(files)
  }

  const handleUploadComplete = (files: FileSelectItem[]) => {
    console.log('FileSelect - Upload completed:', files)
  }

  const handleError = (error: string) => {
    console.error('FileSelect error:', error)
  }

  return (
    <div className='space-y-8'>
      {/* Multiple File Selection */}
      <div className='space-y-4'>
        <div>
          <h4 className='text-lg font-semibold mb-2'>Multiple File Selection</h4>
          <p className='text-sm text-gray-600 mb-4'>
            Select or upload multiple files with validation. Max 5 files, 10MB each, images and
            documents only.
          </p>
        </div>

        <FileSelect
          allowMultiple={true}
          maxFiles={5}
          maxFileSize={10 * 1024 * 1024} // 10MB
          fileExtensions={['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx']}
          entityType='article:attachment'
          onChange={handleFilesChange}
          onUploadComplete={handleUploadComplete}
          onError={handleError}
          placeholder='Drop images or documents here, or click to select'
        />

        {multipleFiles.length > 0 && (
          <div className='p-4 bg-blue-50 border border-blue-200 rounded-lg'>
            <h5 className='font-medium text-blue-800 mb-2'>
              Selected Files ({multipleFiles.length}):
            </h5>
            <div className='space-y-2'>
              {multipleFiles.map((file) => (
                <div key={file.id} className='flex items-center gap-3 text-sm bg-white p-2 rounded'>
                  <span className='font-medium'>{file.name}</span>
                  <Badge variant='outline'>{file.source}</Badge>
                  {file.uploadStatus && (
                    <Badge variant={file.uploadStatus === 'completed' ? 'default' : 'secondary'}>
                      {file.uploadStatus}
                    </Badge>
                  )}
                  <span className='text-gray-500'>{(file.size / 1024).toFixed(1)} KB</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Single File Selection */}
      <div className='space-y-4'>
        <div>
          <h4 className='text-lg font-semibold mb-2'>Single File Selection</h4>
          <p className='text-sm text-gray-600 mb-4'>
            Select or upload a single file. Any file type accepted.
          </p>
        </div>

        <FileSelect
          allowMultiple={false}
          maxFiles={1}
          entityType='FILE'
          onChange={handleSingleFileChange}
          onUploadComplete={handleUploadComplete}
          onError={handleError}
          placeholder='Select one file'
        />

        {singleFile.length > 0 && (
          <div className='p-4 bg-green-50 border border-green-200 rounded-lg'>
            <h5 className='font-medium text-green-800 mb-2'>Selected File:</h5>
            <div className='bg-white p-3 rounded'>
              <div className='flex items-center gap-3'>
                <span className='font-medium'>{singleFile[0].name}</span>
                <Badge variant='outline'>{singleFile[0].source}</Badge>
                {singleFile[0].uploadStatus && (
                  <Badge
                    variant={singleFile[0].uploadStatus === 'completed' ? 'default' : 'secondary'}>
                    {singleFile[0].uploadStatus}
                  </Badge>
                )}
              </div>
              <p className='text-sm text-gray-500 mt-1'>
                Size: {(singleFile[0].size / 1024).toFixed(1)} KB | Type: {singleFile[0].type}
              </p>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Compact Mode */}
      <div className='space-y-4'>
        <div>
          <h4 className='text-lg font-semibold mb-2'>Compact Mode</h4>
          <p className='text-sm text-gray-600 mb-4'>
            FileSelect in compact mode for use in forms and tight spaces. Upload only (no file
            picker).
          </p>
        </div>

        <FileSelect
          allowMultiple={true}
          maxFiles={3}
          compact={true}
          showFilePicker={false}
          entityType='FILE'
          placeholder='Compact file selector'
          onChange={handleCompactFilesChange}
          onError={handleError}
        />

        {compactFiles.length > 0 && (
          <div className='p-3 bg-gray-50 border rounded'>
            <h5 className='text-sm font-medium mb-2'>Compact Selection ({compactFiles.length}):</h5>
            <div className='flex flex-wrap gap-2'>
              {compactFiles.map((file) => (
                <Badge key={file.id} variant='outline' className='text-xs'>
                  {file.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* FileSelectDialog Demo */}
      <div className='space-y-4'>
        <div>
          <h4 className='text-lg font-semibold mb-2'>FileSelectDialog</h4>
          <p className='text-sm text-gray-600 mb-4'>
            Standalone file selection dialog. Click to open the full file browser in a dialog.
          </p>
        </div>

        <div className='flex gap-3'>
          <FileSelectDialog
            onFilesSelected={(files) => {
              console.log('Dialog selected files:', files)
              // Convert FileItem[] to FileSelectItem[] for display
              const selectItems: FileSelectItem[] = files.map((file) => ({
                id: file.id,
                name: file.name,
                size: file.displaySize,
                type: file.mimeType || '',
                source: 'existing',
                url: (file as any).url,
                serverFileId: file.id,
                mimeType: file.mimeType || undefined,
                path: file.path,
                createdAt: file.createdAt,
                updatedAt: file.updatedAt,
                parentId: file.parentId,
              }))
              setMultipleFiles((prev) => [...prev, ...selectItems])
            }}
            allowMultiple={true}
            maxSelection={3}
            title='Select Files from Library'
            description='Choose up to 3 files from your existing library'
          />

          <FileSelectDialog
            onFilesSelected={(files) => {
              console.log('Single dialog selected file:', files[0])
              if (files[0]) {
                const selectItem: FileSelectItem = {
                  id: files[0].id,
                  name: files[0].name,
                  size: files[0].displaySize,
                  type: files[0].mimeType || '',
                  source: 'existing',
                  url: (files[0] as any).url,
                  serverFileId: files[0].id,
                  mimeType: files[0].mimeType || undefined,
                  path: files[0].path,
                  createdAt: files[0].createdAt,
                  updatedAt: files[0].updatedAt,
                  parentId: files[0].parentId,
                }
                setSingleFile([selectItem])
              }
            }}
            allowMultiple={false}
            title='Select Single File'
            description='Choose one file from your library'
            trigger={<Button variant='secondary'>Select Single File</Button>}
          />
        </div>
      </div>

      <Separator />

      {/* FileSelectPicker Demo */}
      <div className='space-y-4'>
        <div>
          <h4 className='text-lg font-semibold mb-2'>FileSelectPicker (Popover)</h4>
          <p className='text-sm text-gray-600 mb-4'>
            New popover-based file selection component. Combines upload and existing file selection
            in a compact popover interface.
          </p>
        </div>

        <div className='flex gap-3'>
          <FileSelectPicker
            allowMultiple={true}
            maxFiles={3}
            maxFileSize={5 * 1024 * 1024} // 5MB
            fileTypes={['.jpg', '.png', '.pdf']}
            entityType='article:attachment'
            onSelect={(files) => {
              console.log('FileSelectPicker selected files:', files)
              setMultipleFiles((prev) => [...prev, ...files])
            }}
            onUploadComplete={(files) => {
              console.log('FileSelectPicker upload completed:', files)
            }}>
            <Button variant='outline'>📎 Attach Files</Button>
          </FileSelectPicker>

          <FileSelectPicker
            allowMultiple={false}
            maxFiles={1}
            entityType='FILE'
            onSelect={(files) => {
              console.log('FileSelectPicker single file:', files[0])
              if (files[0]) {
                setSingleFile([files[0]])
              }
            }}>
            <Button variant='secondary'>📂 Select One File</Button>
          </FileSelectPicker>
        </div>
      </div>
    </div>
  )
}

/**
 * Files Picker Example Component
 */
function FilesPickerExample() {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [allowFiles, setAllowFiles] = useState(true)
  const [allowFolders, setAllowFolders] = useState(true)
  const [allowMultiple, setAllowMultiple] = useState(true)
  const [onlyLeafSelection, setOnlyLeafSelection] = useState(false)
  const [fileExtensions, setFileExtensions] = useState<string[]>([])

  const handleSelectionChange = (selection: FileSelection) => {
    setSelectedFiles(selection.files)
    setSelectedFolders(selection.folders)
  }

  const toggleExtension = (ext: string) => {
    setFileExtensions((prev) =>
      prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext]
    )
  }

  return (
    <div className='space-y-6'>
      {/* Configuration Panel */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg'>
        <div className='space-y-3'>
          <h4 className='font-medium text-sm'>Selection Options</h4>
          <div className='space-y-2'>
            <label className='flex items-center space-x-2'>
              <input
                type='checkbox'
                checked={allowFiles}
                onChange={(e) => setAllowFiles(e.target.checked)}
                className='rounded'
              />
              <span className='text-sm'>Allow Files</span>
            </label>
            <label className='flex items-center space-x-2'>
              <input
                type='checkbox'
                checked={allowFolders}
                onChange={(e) => setAllowFolders(e.target.checked)}
                className='rounded'
              />
              <span className='text-sm'>Allow Folders</span>
            </label>
            <label className='flex items-center space-x-2'>
              <input
                type='checkbox'
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className='rounded'
              />
              <span className='text-sm'>Allow Multiple</span>
            </label>
            <label className='flex items-center space-x-2'>
              <input
                type='checkbox'
                checked={onlyLeafSelection}
                onChange={(e) => setOnlyLeafSelection(e.target.checked)}
                className='rounded'
              />
              <span className='text-sm'>Only Leaf Selection</span>
            </label>
          </div>
        </div>

        <div className='space-y-3'>
          <h4 className='font-medium text-sm'>File Filters</h4>
          <div className='space-y-2'>
            <div className='text-xs text-gray-600'>File Extensions:</div>
            <div className='flex flex-wrap gap-2'>
              {['pdf', 'jpg', 'png', 'txt', 'csv', 'json'].map((ext) => (
                <button
                  key={ext}
                  onClick={() => toggleExtension(ext)}
                  className={`px-2 py-1 text-xs rounded ${
                    fileExtensions.includes(ext)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}>
                  .{ext}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* File Picker Demo */}
      <div className='space-y-4'>
        <div className='flex flex-wrap gap-3'>
          <FilesPicker
            trigger={<Button variant='outline'>Select Files (Popover)</Button>}
            selectedFiles={selectedFiles}
            selectedFolders={selectedFolders}
            onChange={handleSelectionChange}
            allowFiles={allowFiles}
            allowFolders={allowFolders}
            allowMultiple={allowMultiple}
            onlyLeafSelection={onlyLeafSelection}
            fileExtensions={fileExtensions.length > 0 ? fileExtensions : undefined}
            enableGlobalSearch={true}
            showPath={true}
            width={450}
            maxHeight={400}
          />

          <Button
            variant='outline'
            onClick={() => {
              setSelectedFiles([])
              setSelectedFolders([])
            }}>
            Clear Selection
          </Button>
        </div>

        {/* Selection Display */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          <div className='p-4 bg-blue-50 border border-blue-200 rounded-lg'>
            <h4 className='font-medium text-blue-800 mb-2'>
              Selected Files ({selectedFiles.length})
            </h4>
            {selectedFiles.length > 0 ? (
              <div className='space-y-1 max-h-32 overflow-y-auto'>
                {selectedFiles.map((fileId) => (
                  <div key={fileId} className='text-sm text-blue-700 bg-white px-2 py-1 rounded'>
                    {fileId}
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-sm text-blue-600 italic'>No files selected</p>
            )}
          </div>

          <div className='p-4 bg-green-50 border border-green-200 rounded-lg'>
            <h4 className='font-medium text-green-800 mb-2'>
              Selected Folders ({selectedFolders.length})
            </h4>
            {selectedFolders.length > 0 ? (
              <div className='space-y-1 max-h-32 overflow-y-auto'>
                {selectedFolders.map((folderId) => (
                  <div key={folderId} className='text-sm text-green-700 bg-white px-2 py-1 rounded'>
                    {folderId}
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-sm text-green-600 italic'>No folders selected</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Dataset Upload Example Component
 */
function DatasetUploadExample({
  onComplete,
  onError,
  onProgress,
}: {
  onComplete: (results: BatchUploadResult) => void
  onError: (error: string) => void
  onProgress: (progress: BatchUploadResult) => void
}) {
  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg'>
        <div className='text-center'>
          <div className='text-lg font-semibold text-green-600'>Upload</div>
          <div className='text-sm text-gray-600'>Direct transfer to storage</div>
        </div>
        <div className='text-center'>
          <div className='text-lg font-semibold text-blue-600'>Processing</div>
          <div className='text-sm text-gray-600'>Data validation & parsing</div>
        </div>
        <div className='text-center'>
          <div className='text-lg font-semibold text-purple-600'>Indexing</div>
          <div className='text-sm text-gray-600'>Search index generation</div>
        </div>
      </div>

      <Separator />

      <FileQueueManager
        entityType='dataset'
        entityId='cme2h4pbu0000tdvnpr8deyig'
        onComplete={onComplete}
        onError={onError}
        onProgress={onProgress}
        showDropZone={true}
        showControls={true}
        showProgress={true}
        maxFiles={5}
        emptyState={
          <div className='text-center py-8'>
            <div className='text-lg font-medium text-gray-700 mb-2'>Upload Dataset Files</div>
            <p className='text-sm text-gray-500 mb-4'>
              Supported formats: CSV, JSON, Excel, PDF, TXT
            </p>
            <div className='text-xs text-gray-400'>
              Files will be processed through upload → validation → indexing stages
            </div>
          </div>
        }
      />
    </div>
  )
}

/**
 * File Upload Examples Page
 */
export default function FileUploadExamplesPage() {
  const [uploadResults, setUploadResults] = useState<BatchUploadResult[]>([])
  const [activeTab, setActiveTab] = useState('basic')

  /**
   * Handles showing a demo success toast for manual testing.
   */
  const handleShowSuccessToast = () => {
    // Test success toast with a single action button
    toastSuccess({
      title: 'Upload Complete',
      description: 'Your files have been uploaded successfully.',
      actions: {
        label: 'View Files',
        onClick: (dismiss) => {
          console.log('View Files clicked')
          dismiss()
        },
        variant: 'default',
        size: 'sm',
      },
    })
  }

  const handleShowErrorToast = () => {
    // Test error toast with multiple action buttons (button config objects)
    toastError({
      title: 'Workflow Error',
      description: 'Something went wrong with the workflow connection.',
      duration: Infinity,
      actions: [
        {
          label: 'Try Again',
          onClick: (dismiss) => {
            console.log('Try Again clicked from toast')
            // Don't dismiss - simulate retry without closing toast
          },
          variant: 'outline',
          size: 'sm',
        },
        {
          label: 'Cancel Run',
          onClick: (dismiss) => {
            console.log('Cancel Run clicked from toast')
            dismiss() // Dismiss the toast after canceling
          },
          variant: 'destructive',
          size: 'sm',
        },
      ],
      onDismiss: () => {
        console.log('Toast dismissed')
      },
    })
  }

  const handleShowCustomActionToast = () => {
    // Test with custom React component as action
    toastError({
      title: 'Custom Action Toast',
      description: 'This toast has a custom React component as an action.',
      duration: Infinity,
      actions: (
        <div className='flex gap-2'>
          <Button variant='outline' size='xs' onClick={() => console.log('Custom button 1')}>
            Custom 1
          </Button>
          <Button variant='secondary' size='xs' onClick={() => console.log('Custom button 2')}>
            Custom 2
          </Button>
        </div>
      ),
    })
  }

  const handleUploadComplete = (results: BatchUploadResult) => {
    console.log('Upload completed:', results)
    setUploadResults((prev) => [...prev, results])
  }

  const handleUploadError = (error: string) => {
    console.error('Upload error:', error)
  }

  const handleProgress = (progress: BatchUploadResult) => {
    console.log('Upload progress:', progress)
  }

  const clearResults = () => {
    setUploadResults([])
  }

  return (
    <div className='container mx-auto py-6 space-y-6 overflow-y-auto'>
      {/* Header */}
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='space-y-2'>
          <h1 className='text-3xl font-bold'>File Upload Components</h1>
          <p className='text-muted-foreground'>
            Interactive examples showcasing the presigned upload system with direct-to-storage
            transfers, per-file cancellation, and unified hook architecture.
          </p>
        </div>
        <div className='flex gap-2 flex-row flex-wrap'>
          <Button variant='outline' onClick={handleShowSuccessToast}>
            Show Success Toast
          </Button>
          <Button variant='outline' onClick={handleShowErrorToast}>
            Show Error Toast
          </Button>
          <Button variant='outline' onClick={handleShowCustomActionToast}>
            Show Custom Action Toast
          </Button>
        </div>
      </div>

      {/* Results Summary */}
      {uploadResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center justify-between'>
              Upload Results
              <Button variant='outline' size='sm' onClick={clearResults}>
                Clear Results
              </Button>
            </CardTitle>
            <CardDescription>Summary of completed upload operations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              {uploadResults.map((result, index) => (
                <div
                  key={index}
                  className='flex items-center justify-between p-3 bg-gray-50 rounded-lg'>
                  <div className='flex items-center gap-3'>
                    <Badge variant={result.failedCount > 0 ? 'destructive' : 'default'}>
                      Upload #{index + 1}
                    </Badge>
                    <span className='text-sm'>
                      {result.totalFiles} files • {result.successCount} success •{' '}
                      {result.failedCount} failed
                    </span>
                  </div>
                  <div className='text-sm text-gray-500'>{result.overallProgress}% complete</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Examples */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className='space-y-4'>
        <TabsList className='grid grid-cols-5 w-full'>
          <TabsTrigger value='basic'>Basic</TabsTrigger>
          <TabsTrigger value='minimal'>Minimal</TabsTrigger>
          <TabsTrigger value='dataset'>Dataset</TabsTrigger>
          <TabsTrigger value='fileselect'>FileSelect</TabsTrigger>
          <TabsTrigger value='picker'>File Picker</TabsTrigger>
        </TabsList>

        {/* Basic Example */}
        <TabsContent value='basic' className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>Basic File Upload</CardTitle>
              <CardDescription>
                Standard file upload interface with real-time progress, queue management, and SSE
                updates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BasicUploadExample
                onComplete={handleUploadComplete}
                onError={handleUploadError}
                onProgress={handleProgress}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Minimal Example */}
        <TabsContent value='minimal' className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>Minimal Upload Interface</CardTitle>
              <CardDescription>
                Compact upload interface with minimal UI and simplified file display.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MinimalUploadExample onComplete={handleUploadComplete} onError={handleUploadError} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dataset Upload Example */}
        <TabsContent value='dataset' className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>Dataset File Upload</CardTitle>
              <CardDescription>
                Specialized upload interface for dataset files with processing stages and
                validation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DatasetUploadExample
                onComplete={handleUploadComplete}
                onError={handleUploadError}
                onProgress={handleProgress}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* FileSelect Component Example */}
        <TabsContent value='fileselect' className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>FileSelect Component</CardTitle>
              <CardDescription>
                Unified file selection component that combines file upload and existing file
                selection in a single interface. Supports validation, multiple modes, and seamless
                integration with the file system.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileSelectExample />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Files Picker Example */}
        <TabsContent value='picker' className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>Files Picker Component</CardTitle>
              <CardDescription>
                Interactive file and folder picker with hierarchical navigation, search, and
                flexible selection options.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FilesPickerExample />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
