// apps/web/src/app/(protected)/app/rules/_components/testing/testing-import-file.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { z } from 'zod'
import { Button } from '@auxx/ui/components/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@auxx/ui/components/form'
import { FileUpload } from './file-upload'

const fileImportSchema = z.object({
  file: z.any().refine((file) => file instanceof File, { error: 'Please select a file to upload' }),
  format: z.enum(['csv', 'json']),
})

type FileImportFormData = z.infer<typeof fileImportSchema>

interface TestingImportFileProps {
  onSubmit: (data: FileImportFormData) => Promise<void>
  isLoading?: boolean
}

export function TestingImportFile({ onSubmit, isLoading }: TestingImportFileProps) {
  const router = useRouter()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const form = useForm<FileImportFormData>({
    resolver: standardSchemaResolver(fileImportSchema),
    defaultValues: { format: 'csv' },
  })

  const handleFileUpload = (file: File) => {
    setSelectedFile(file)
    form.setValue('file', file)

    // Auto-detect format from file extension
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension === 'csv' || extension === 'json') {
      form.setValue('format', extension as 'csv' | 'json')
    }
  }

  const handleFormSubmit = async (data: FileImportFormData) => {
    try {
      await onSubmit(data)
    } catch (error) {
      console.error('Error submitting file import form:', error)
    }
  }

  const downloadTemplate = () => {
    // Create a sample CSV template
    const csvContent = `name,description,subject,from,to,body,tags
"Order confirmation test","Test order confirmation emails","Order #1234 confirmed","noreply@store.com","customer@example.com","Thank you for your order #1234","order,confirmation"
"Shipping notification test","Test shipping notification emails","Your order has shipped","noreply@store.com","customer@example.com","Your order #1234 has been shipped","shipping,tracking"`

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'test-case-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  return (
    <div>
      <CardHeader>
        <CardTitle>Import from File</CardTitle>
        <CardDescription>Upload a CSV or JSON file containing test case data</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
            <div>
              <h4 className="font-medium mb-4">Upload File</h4>
              <FormField
                control={form.control}
                name="file"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormControl>
                      <FileUpload accept=".csv,.json" onUpload={handleFileUpload} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedFile && (
                <div className="mt-4 p-3 bg-muted rounded-md">
                  <p className="text-sm">
                    <strong>Selected file:</strong> {selectedFile.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Size: {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-center">
              <Button type="button" variant="link" size="sm" onClick={downloadTemplate}>
                Download CSV Template
              </Button>
            </div>

            <div className="border rounded-lg p-4 bg-muted/50">
              <h4 className="font-medium mb-2">File Format Requirements</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • CSV files should include headers: name, description, subject, from, to, body
                </li>
                <li>• JSON files should follow the test case schema format</li>
                <li>• Maximum file size: 10MB</li>
                <li>• Maximum 100 test cases per file</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/app/rules/testing')}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || !selectedFile}>
                {isLoading ? 'Importing...' : 'Import Test Cases'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </div>
  )
}
