// apps/web/src/app/(protected)/app/rules/testing/new/page.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, FileText, Package } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageContent,
  MainPageHeader,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
} from '@auxx/ui/components/main-page'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { TestingImportManual } from '../../_components/testing/testing-import-manual'
import { TestingImportThread } from '../../_components/testing/testing-import-thread'
import { TestingImportFile } from '../../_components/testing/testing-import-file'
import { TestingImportTemplate } from '../../_components/testing/testing-import-template'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { RadioGroup } from '@auxx/ui/components/radio-group'

export default function CreateTestCasePage() {
  const router = useRouter()
  const utils = api.useUtils()
  const [importSource, setImportSource] = useState<'manual' | 'thread' | 'file' | 'template'>(
    'manual'
  )

  const createTestCase = api.testCase.create.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Test case created',
        description: 'Your test case has been created successfully',
      })
    },
    onError: (error) => {
      toastError({ title: 'Failed to create test case', description: error.message })
    },
  })

  const handleManualSubmit = async (data: any) => {
    console.log('Manual import data:', data)
    await createTestCase.mutateAsync(data)
    await utils.testCase.invalidate() // Invalidate cache to refresh test case list
    router.push('/app/rules/testing')
  }

  const handleThreadSubmit = async (data: any) => {
    // Convert thread import data to test case format
    const testCaseData = {
      name: data.name,
      description: data.description,
      email: {
        subject: 'Imported from thread',
        from: 'example@domain.com',
        to: ['recipient@domain.com'],
        body: 'Email content from thread will be populated here',
      },
      expectedRules: [],
      expectedActions: [],
      tags: data.tags ? data.tags.split(',').map((tag: string) => tag.trim()) : [],
      status: 'ACTIVE' as const,
    }
    await createTestCase.mutateAsync(testCaseData)
    await utils.testCase.invalidate() // Invalidate cache to refresh test case list
    router.push('/app/rules/testing')
  }

  const handleFileSubmit = async (data: any) => {
    // Handle file import - for now just show success
    console.log('File import data:', data)
    await utils.testCase.invalidate() // Invalidate cache to refresh test case list
    router.push('/app/rules/testing')
  }

  const handleTemplateSubmit = async (data: any) => {
    // Convert template data to test case format
    const testCaseData = {
      name: data.name,
      description: `Test case created from template: ${data.template.name}`,
      email: {
        subject: 'Template-based test case',
        from: 'template@domain.com',
        to: ['test@domain.com'],
        body: 'Email content based on template will be populated here',
      },
      expectedRules: [],
      expectedActions: [],
      tags: data.tags ? data.tags.split(',').map((tag: string) => tag.trim()) : [],
      status: 'ACTIVE' as const,
    }
    await createTestCase.mutateAsync(testCaseData)
    await utils.testCase.invalidate() // Invalidate cache to refresh test case list
    router.push('/app/rules/testing')
  }

  return (
    <MainPage>
      <MainPageHeader
        action={
          <Link href="/app/rules/testing">
            <Button variant="ghost">
              <ChevronLeft className="size-4" />
              Back
            </Button>
          </Link>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem href="/app/rules" title="Rules" />
          <MainPageBreadcrumbItem href="/app/rules/testing" title="Testing" />
          <MainPageBreadcrumbItem href="/app/rules/testing/new" title="New Test Case" last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <div className="h-full overflow-y-auto relative">
          <div className="grid grid-cols-1 lg:grid-cols-3 h-full">
            {/* Left Column - Import Options */}
            <div className="p-3 bg-background md:bg-transparent border-b md:border-b-0 border-r-0 md:border-r">
              <div className="space-y-4 sticky top-3 ">
                <RadioGroup
                  value={importSource}
                  onValueChange={(value) =>
                    setImportSource(value as 'manual' | 'thread' | 'file' | 'template')
                  }>
                  <RadioGroupItemCard
                    label="Create Manually"
                    value="manual"
                    description="Build a test case from scratch"
                  />
                  <RadioGroupItemCard
                    label="Import from Threads"
                    value="thread"
                    description="Use real email threads as test cases"
                  />
                  <RadioGroupItemCard
                    label="Import from File"
                    value="file"
                    icon={<FileText />}
                    description="Upload a CSV or JSON file to create test cases"
                  />
                  <RadioGroupItemCard
                    label="Use Template"
                    value="template"
                    icon={<Package />}
                    description="Start from a pre-built template"
                  />
                </RadioGroup>
              </div>
            </div>

            {/* Right Column - Tab Content */}
            <div className="lg:col-span-2 bg-background  h-full ">
              {importSource === 'manual' && (
                <TestingImportManual
                  onSubmit={handleManualSubmit}
                  isLoading={createTestCase.isPending}
                />
              )}

              {importSource === 'thread' && (
                <TestingImportThread
                  onSubmit={handleThreadSubmit}
                  isLoading={createTestCase.isPending}
                />
              )}

              {importSource === 'file' && (
                <TestingImportFile
                  onSubmit={handleFileSubmit}
                  isLoading={createTestCase.isPending}
                />
              )}

              {importSource === 'template' && (
                <TestingImportTemplate
                  onSubmit={handleTemplateSubmit}
                  isLoading={createTestCase.isPending}
                />
              )}
            </div>
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
