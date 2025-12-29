// apps/web/src/test/mocks.ts

/**
 * Mock factories for common external services and APIs
 */

import { vi } from 'vitest'

/**
 * Mock tRPC API client
 */
export const mockApi = {
  user: {
    me: {
      useQuery: vi.fn(() => ({
        data: { id: 'test-user', email: 'test@example.com', name: 'Test User' },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })),
    },
    update: {
      useMutation: vi.fn(() => ({
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isLoading: false,
        isSuccess: false,
        error: null,
        reset: vi.fn(),
      })),
    },
  },
  organization: {
    getCurrent: {
      useQuery: vi.fn(() => ({
        data: { id: 'test-org', name: 'Test Organization', slug: 'test-org' },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })),
    },
    update: {
      useMutation: vi.fn(() => ({
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isLoading: false,
        isSuccess: false,
        error: null,
        reset: vi.fn(),
      })),
    },
  },
  ticket: {
    getAll: {
      useQuery: vi.fn(() => ({
        data: [
          { id: 'ticket-1', subject: 'Test Ticket 1', status: 'open' },
          { id: 'ticket-2', subject: 'Test Ticket 2', status: 'closed' },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })),
    },
    create: {
      useMutation: vi.fn(() => ({
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isLoading: false,
        isSuccess: false,
        error: null,
        reset: vi.fn(),
      })),
    },
  },
  workflow: {
    getAll: {
      useQuery: vi.fn(() => ({
        data: [
          { id: 'workflow-1', name: 'Test Workflow 1', enabled: true },
          { id: 'workflow-2', name: 'Test Workflow 2', enabled: false },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      })),
    },
    execute: {
      useMutation: vi.fn(() => ({
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isLoading: false,
        isSuccess: false,
        error: null,
        reset: vi.fn(),
      })),
    },
  },
}

/**
 * Mock Zustand stores
 */
export function createMockStore<T>(initialState: T) {
  let state = { ...initialState }
  
  return {
    getState: () => state,
    setState: (partial: Partial<T>) => {
      state = { ...state, ...partial }
    },
    subscribe: vi.fn(),
    destroy: vi.fn(),
  }
}

/**
 * Mock file upload utilities
 */
export const mockFileUpload = {
  uploadFile: vi.fn().mockResolvedValue({
    id: 'file-123',
    url: 'https://example.com/file.pdf',
    name: 'test-file.pdf',
    size: 1024,
  }),
  deleteFile: vi.fn().mockResolvedValue(true),
  getSignedUrl: vi.fn().mockResolvedValue('https://example.com/signed-url'),
}

/**
 * Mock external APIs
 */
export const mockExternalApis = {
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: 'Mock AI response',
                role: 'assistant',
              },
            },
          ],
        }),
      },
    },
  },
  stripe: {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
      retrieve: vi.fn().mockResolvedValue({ id: 'cus_test123', email: 'test@example.com' }),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({ id: 'sub_test123', status: 'active' }),
      cancel: vi.fn().mockResolvedValue({ id: 'sub_test123', status: 'canceled' }),
    },
  },
  shopify: {
    customers: {
      get: vi.fn().mockResolvedValue({ id: 123, email: 'customer@shopify.com' }),
    },
    orders: {
      list: vi.fn().mockResolvedValue([
        { id: 1001, total_price: '29.99', financial_status: 'paid' },
      ]),
    },
  },
}

/**
 * Mock browser APIs
 */
export const mockBrowserApis = {
  fetch: vi.fn(),
  localStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  sessionStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  notification: {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn().mockResolvedValue('granted' as NotificationPermission),
  },
}

/**
 * Mock WebSocket for real-time features
 */
export class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  onopen = vi.fn()
  onclose = vi.fn()
  onmessage = vi.fn()
  onerror = vi.fn()

  constructor(public url: string) {}

  send = vi.fn()
  close = vi.fn()

  // Helper methods for testing
  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({} as CloseEvent)
  }

  simulateError() {
    this.onerror?.({} as Event)
  }
}

/**
 * Mock Pusher for real-time events
 */
export const mockPusher = {
  subscribe: vi.fn(() => ({
    bind: vi.fn(),
    unbind: vi.fn(),
    trigger: vi.fn(),
  })),
  unsubscribe: vi.fn(),
  disconnect: vi.fn(),
}

/**
 * Mock form validation
 */
export const mockFormValidation = {
  validateEmail: vi.fn((email: string) => /\S+@\S+\.\S+/.test(email)),
  validatePassword: vi.fn((password: string) => password.length >= 8),
  validateRequired: vi.fn((value: any) => value != null && value !== ''),
}

/**
 * Setup function to mock all external dependencies
 */
export function setupMocks() {
  // Mock global fetch
  global.fetch = mockBrowserApis.fetch
  
  // Mock WebSocket
  global.WebSocket = MockWebSocket as any
  
  // Mock tRPC
  vi.mock('~/trpc/react', () => ({
    api: mockApi,
  }))
  
  // Mock external services
  vi.mock('openai', () => ({
    default: class MockOpenAI {
      chat = mockExternalApis.openai.chat
    },
  }))
  
  vi.mock('stripe', () => ({
    default: class MockStripe {
      customers = mockExternalApis.stripe.customers
      subscriptions = mockExternalApis.stripe.subscriptions
    },
  }))
  
  // Mock Pusher
  vi.mock('pusher-js', () => ({
    default: class MockPusherClient {
      subscribe = mockPusher.subscribe
      unsubscribe = mockPusher.unsubscribe
      disconnect = mockPusher.disconnect
    },
  }))
}

/**
 * Reset all mocks (call this in beforeEach or afterEach)
 */
export function resetMocks() {
  vi.clearAllMocks()
  Object.values(mockApi).forEach(router => {
    Object.values(router).forEach(procedure => {
      if ('useQuery' in procedure) procedure.useQuery.mockClear()
      if ('useMutation' in procedure) procedure.useMutation.mockClear()
    })
  })
}