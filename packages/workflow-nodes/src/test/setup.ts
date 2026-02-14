// packages/workflow-nodes/src/test/setup.ts

import { loadEnv } from 'vite'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

// Load test environment variables
const env = loadEnv('test', process.cwd(), '')
Object.assign(process.env, env)

// Set test environment
process.env.NODE_ENV = 'test'

// Mock external dependencies commonly used in workflow nodes
vi.mock('@auxx/database', () => ({
  database: {
    query: {
      Workflow: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      WorkflowRun: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      // Add other models as needed
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
  },
  schema: {
    Workflow: vi.fn(),
    WorkflowRun: vi.fn(),
    // Add other schema tables as needed
  },
}))

// Mock workflow execution context
vi.mock('@auxx/lib/workflow-engine', () => ({
  WorkflowExecutionContext: vi.fn(() => ({
    getVariable: vi.fn(),
    setVariable: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  })),
}))

// Global test setup
beforeAll(() => {
  // Add any global setup here
})

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks()
})

afterAll(() => {
  // Add any global cleanup here
})
