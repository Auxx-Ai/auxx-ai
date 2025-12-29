// apps/web/src/app/(protected)/app/rules/testing/[id]/edit/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
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
import { TestingImportManual } from '../../../_components/testing/testing-import-manual'
import { LoadingContent } from '~/components/global/loading-content'

export default function EditTestCasePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const utils = api.useUtils()
  const testCaseId = params.id

  // Fetch existing test case data
  const { data: testCase, isLoading: isLoadingTestCase } = api.testCase.get.useQuery({
    id: testCaseId,
  })

  // Update test case mutation
  const updateTestCase = api.testCase.update.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Test case updated',
        description: 'Your test case has been updated successfully',
      })
      router.push(`/app/rules/testing`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to update test case', description: error.message })
    },
  })

  const handleSubmit = async (data: any) => {
    await updateTestCase.mutateAsync({
      id: testCaseId,
      data: {
        name: data.name,
        description: data.description,
        email: data.email,
        expectedRules: data.expectedRules,
        expectedActions: data.expectedActions,
        tags: data.tags,
        status: data.status,
      },
    })
    await utils.testCase.invalidate() // Invalidate cache to refresh test case list
  }

  // Format initial data for the form
  const initialData = testCase
    ? {
        name: testCase.name,
        description: testCase.description || '',
        email: {
          subject: testCase.email?.subject || '',
          from: testCase.email?.from || '',
          to: testCase.email?.to || [],
          cc: testCase.email?.cc || [],
          body: testCase.email?.body || '',
        },
        expectedRules: testCase.expectedRules || [],
        expectedActions: testCase.expectedActions || [],
        tags: testCase.tags || [],
        status: testCase.status,
      }
    : undefined

  return (
    <MainPage>
      <MainPageHeader
        action={
          <Link href={`/app/rules/testing`}>
            <Button variant="ghost">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Test Case
            </Button>
          </Link>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem href="/app/rules" title="Rules" />
          <MainPageBreadcrumbItem href="/app/rules/testing" title="Testing" />
          <MainPageBreadcrumbItem
            href={`/app/rules/testing`}
            title={testCase?.name || 'Test Case'}
          />
          <MainPageBreadcrumbItem
            href={`/app/rules/testing/${testCaseId}/edit`}
            title="Edit"
            last
          />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <div className="h-full overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 h-full">
            {/* Left Column - Info */}
            <div className="p-3">
              <div className="space-y-4 sticky top-3">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Edit Test Case</h3>
                  <p className="text-sm text-muted-foreground">
                    Update the test case details, email content, and expected behavior.
                  </p>
                </div>

                {testCase && (
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Created:</span>{' '}
                      {new Date(testCase.createdAt).toLocaleDateString()}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Version:</span> {testCase.version}
                    </div>
                    {testCase.updatedAt !== testCase.createdAt && (
                      <div>
                        <span className="text-muted-foreground">Last updated:</span>{' '}
                        {new Date(testCase.updatedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Edit Form */}
            <div className="lg:col-span-2 bg-background border-l h-full">
              {isLoadingTestCase ? (
                <LoadingContent />
              ) : testCase ? (
                <TestingImportManual
                  onSubmit={handleSubmit}
                  isLoading={updateTestCase.isPending}
                  isEditMode={true}
                  testCaseId={testCaseId}
                  initialData={initialData}
                />
              ) : (
                <div className="p-8 text-center">
                  <p className="text-muted-foreground">Test case not found</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
