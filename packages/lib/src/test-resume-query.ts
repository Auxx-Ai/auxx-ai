// packages/lib/src/test-resume-query.ts
// Test to reproduce the exact query that fails in resume job

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

const workflowRunId = 'aa0dy4nsli302l2ky2btx2uf' // From your log

async function testResumeQuery() {
  console.log('Testing the exact query that fails...\n')

  // This is the EXACT query from workflow-execution-service.ts line 527
  try {
    console.log('Attempting relational query...')
    const workflowRun = await db.query.WorkflowRun.findFirst({
      where: eq(schema.WorkflowRun.id, workflowRunId),
      with: {
        workflow: true,
        createdBy: {
          columns: { email: true, name: true },
        },
      },
    })

    console.log('✅ SUCCESS! Query worked')
    console.log('WorkflowRun found:', !!workflowRun)
    if (workflowRun) {
      console.log('Has workflow:', !!workflowRun.workflow)
      console.log('Has createdBy:', !!workflowRun.createdBy)
    }
  } catch (error) {
    console.error('❌ FAILED! Error:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error) {
      console.error('Stack:', error.stack)
    }
  }

  process.exit(0)
}

testResumeQuery()
