// apps/web/src/components/workflow/panels/run/tabs/result-tab.tsx

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { useRunStore } from '~/components/workflow/store/run-store'
import CodeEditor, { CodeLanguage } from '~/components/workflow/ui/code-editor'
import Section from '~/components/workflow/ui/section'

/**
 * Result tab showing workflow execution outputs
 */
export function ResultTab() {
  const activeRun = useRunStore((state) => state.activeRun)

  if (!activeRun) {
    return (
      <div className='p-4'>
        <Alert>
          <AlertDescription>
            No workflow run selected. Run a workflow to see results.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (activeRun.status === 'RUNNING') {
    return (
      <div className='p-4'>
        <Alert>
          <AlertDescription>
            Workflow is still running. Results will appear when execution completes.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <>
      <div className='p-3 pb-0 flex items-center justify-between'>
        <span className='text-sm font-medium'>STATUS</span>
        <span
          className={`text-sm font-medium ${
            activeRun.status === 'SUCCEEDED'
              ? 'text-green-600'
              : activeRun.status === 'FAILED'
                ? 'text-red-600'
                : 'text-orange-600'
          }`}>
          {activeRun.status}
        </span>
      </div>

      <Section title='Workflow Outputs' initialOpen>
        <div className='space-y-4'>
          {activeRun.status === 'FAILED' && activeRun.error && (
            <Alert variant='destructive'>
              <AlertDescription>{activeRun.error}</AlertDescription>
            </Alert>
          )}

          {activeRun.outputs != null && (
            <CodeEditor
              value={JSON.stringify(activeRun.outputs, null, 2)}
              language={CodeLanguage.json}
              readOnly
              minHeight={120}
              title='OUTPUT'
              gradientBorder={false}
              downloadFilename={`workflow-run-${activeRun.sequenceNumber}-results.json`}
            />
          )}
        </div>
      </Section>
    </>
  )
}
