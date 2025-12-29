// apps/web/src/app/(protected)/app/test/concurrent-uploads/page.tsx

'use client'

import React, { useState } from 'react'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'

/**
 * Test page to demonstrate multiple concurrent file uploads with different configurations
 * Each component has its own validation rules and they don't interfere with each other
 */
export default function ConcurrentUploadsTestPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold mb-6">Concurrent Uploads Test</h1>
      <p className="text-gray-600 mb-8">
        This page demonstrates that multiple file upload components can run simultaneously with
        different configurations without interfering with each other.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <AvatarUploadSection />
        <DocumentUploadSection />
        <ImageGallerySection />
        <MessageAttachmentSection />
      </div>
    </div>
  )
}

/**
 * Avatar upload - Single image, max 2MB
 */
function AvatarUploadSection() {
  const [uploadedFile, setUploadedFile] = useState<string | null>(null)

  const fileSelect = useFileSelect({
    entityType: 'AVATAR',
    maxFiles: 1,
    maxFileSize: 2 * 1024 * 1024, // 2MB
    fileExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
    allowMultiple: false,
    autoStart: true,
    onUploadComplete: (files) => {
      if (files[0]) {
        setUploadedFile(files[0].name)
      }
    },
    onError: (error) => {
      console.error('Avatar upload error:', error)
    },
  })

  return (
    <Card className="border-blue-200">
      <CardHeader>
        <CardTitle className="text-blue-600">Avatar Upload</CardTitle>
        <CardDescription>Single image only, max 2MB, JPG/PNG only</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              if (files.length > 0) {
                fileSelect.addFiles(files)
              }
            }}
            className="block w-full text-sm"
          />

          {fileSelect.selectedItems.length > 0 && (
            <div className="text-sm">
              <p>Selected: {fileSelect.selectedItems[0]?.name}</p>
              <p>Status: {fileSelect.selectedItems[0]?.status}</p>
              <p>Progress: {fileSelect.selectedItems[0]?.progress}%</p>
            </div>
          )}

          {uploadedFile && <p className="text-green-600 text-sm">✓ Uploaded: {uploadedFile}</p>}

          {fileSelect.errors.length > 0 && (
            <div className="text-red-600 text-sm">
              {fileSelect.errors.map((error, idx) => (
                <p key={idx}>{error}</p>
              ))}
            </div>
          )}

          <Button onClick={() => fileSelect.clearItems()} variant="outline" size="sm">
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Document upload - Multiple PDFs, max 10MB each
 */
function DocumentUploadSection() {
  const fileSelect = useFileSelect({
    entityType: 'FILE',
    maxFiles: 5,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    fileExtensions: ['.pdf', '.doc', '.docx', '.txt'],
    allowMultiple: true,
    autoStart: false,
    onError: (error) => {
      console.error('Document upload error:', error)
    },
  })

  return (
    <Card className="border-green-200">
      <CardHeader>
        <CardTitle className="text-green-600">Document Upload</CardTitle>
        <CardDescription>Up to 5 documents, max 10MB each, PDF/DOC/TXT</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              if (files.length > 0) {
                fileSelect.addFiles(files)
              }
            }}
            className="block w-full text-sm"
          />

          {fileSelect.selectedItems.length > 0 && (
            <div className="text-sm space-y-1">
              <p>Selected {fileSelect.selectedItems.length} file(s):</p>
              {fileSelect.selectedItems.map((item) => (
                <div key={item.id} className="pl-4">
                  • {item.name} - {item.status} ({item.progress}%)
                </div>
              ))}
            </div>
          )}

          {fileSelect.errors.length > 0 && (
            <div className="text-red-600 text-sm">
              {fileSelect.errors.map((error, idx) => (
                <p key={idx}>{error}</p>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => fileSelect.startUpload()}
              disabled={fileSelect.selectedItems.length === 0}
              size="sm">
              Upload Documents
            </Button>
            <Button onClick={() => fileSelect.clearItems()} variant="outline" size="sm">
              Clear
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Image gallery - Multiple images, max 5MB each
 */
function ImageGallerySection() {
  const fileSelect = useFileSelect({
    entityType: 'MEDIA',
    maxFiles: 10,
    maxFileSize: 5 * 1024 * 1024, // 5MB
    fileExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    allowMultiple: true,
    autoStart: true,
    onError: (error) => {
      console.error('Gallery upload error:', error)
    },
  })

  return (
    <Card className="border-purple-200">
      <CardHeader>
        <CardTitle className="text-purple-600">Image Gallery</CardTitle>
        <CardDescription>Up to 10 images, max 5MB each, auto-upload</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              if (files.length > 0) {
                fileSelect.addFiles(files)
              }
            }}
            className="block w-full text-sm"
          />

          {fileSelect.selectedItems.length > 0 && (
            <div className="text-sm space-y-1">
              <p>Gallery has {fileSelect.selectedItems.length} image(s):</p>
              {fileSelect.selectedItems.map((item) => (
                <div key={item.id} className="pl-4">
                  • {item.name} - {item.status}
                </div>
              ))}
            </div>
          )}

          {fileSelect.errors.length > 0 && (
            <div className="text-red-600 text-sm">
              {fileSelect.errors.map((error, idx) => (
                <p key={idx}>{error}</p>
              ))}
            </div>
          )}

          <Button onClick={() => fileSelect.clearItems()} variant="outline" size="sm">
            Clear Gallery
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Message attachments - Small files, max 1MB
 */
function MessageAttachmentSection() {
  const fileSelect = useFileSelect({
    entityType: 'MESSAGE',
    maxFiles: 3,
    maxFileSize: 1024 * 1024, // 1MB
    allowMultiple: true,
    autoStart: false,
    onError: (error) => {
      console.error('Message attachment error:', error)
    },
  })

  return (
    <Card className="border-orange-200">
      <CardHeader>
        <CardTitle className="text-orange-600">Message Attachments</CardTitle>
        <CardDescription>Up to 3 files, max 1MB each, any type</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <input
            type="file"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              if (files.length > 0) {
                fileSelect.addFiles(files)
              }
            }}
            className="block w-full text-sm"
          />

          {fileSelect.selectedItems.length > 0 && (
            <div className="text-sm space-y-1">
              <p>Attachments ({fileSelect.selectedItems.length}/3):</p>
              {fileSelect.selectedItems.map((item) => (
                <div key={item.id} className="pl-4">
                  • {item.name} ({(item.displaySize / 1024).toFixed(1)}KB)
                </div>
              ))}
            </div>
          )}

          {fileSelect.errors.length > 0 && (
            <div className="text-red-600 text-sm">
              {fileSelect.errors.map((error, idx) => (
                <p key={idx}>{error}</p>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={() => fileSelect.startUpload()}
              disabled={fileSelect.selectedItems.length === 0}
              size="sm">
              Attach to Message
            </Button>
            <Button onClick={() => fileSelect.clearItems()} variant="outline" size="sm">
              Clear
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
