// apps/web/src/test/utils.tsx

/**
 * Test utilities for web app (React components and Next.js)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderOptions, render } from '@testing-library/react'
import type React from 'react'
// import { ThemeProvider } from 'next-themes' // Commented out to avoid dependency issues
import { vi } from 'vitest'

/**
 * Creates a fresh QueryClient for testing
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
    logger: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  })
}

/**
 * Wrapper component that provides all necessary contexts
 */
interface TestProvidersProps {
  children: React.ReactNode
  queryClient?: QueryClient
  theme?: string
}

export function TestProviders({ children, queryClient, theme = 'light' }: TestProvidersProps) {
  const client = queryClient || createTestQueryClient()

  return (
    <QueryClientProvider client={client}>
      {/* Simple theme wrapper instead of next-themes to avoid dependencies */}
      <div data-theme={theme}>{children}</div>
    </QueryClientProvider>
  )
}

/**
 * Custom render function that includes providers
 */
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient
  theme?: string
}

export function renderWithProviders(ui: React.ReactElement, options: CustomRenderOptions = {}) {
  const { queryClient, theme, ...renderOptions } = options

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <TestProviders queryClient={queryClient} theme={theme}>
        {children}
      </TestProviders>
    )
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

/**
 * Creates a mock tRPC context
 */
export function createMockTrpcContext() {
  return {
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
      organizationId: 'test-org-id',
    },
    organization: {
      id: 'test-org-id',
      name: 'Test Organization',
      slug: 'test-org',
    },
    db: {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      organization: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      ticket: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      // Add other models as needed
    },
  }
}

/**
 * Creates a mock tRPC client
 */
export function createMockTrpcClient() {
  return {
    user: {
      me: {
        useQuery: vi.fn(() => ({
          data: { id: 'test-user', email: 'test@example.com' },
          isLoading: false,
          error: null,
        })),
      },
      update: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          isLoading: false,
          error: null,
        })),
      },
    },
    organization: {
      getCurrent: {
        useQuery: vi.fn(() => ({
          data: { id: 'test-org', name: 'Test Organization' },
          isLoading: false,
          error: null,
        })),
      },
    },
    // Add other routers as needed
  }
}

/**
 * Creates a mock Next.js router (Pages Router)
 */
export function createMockRouter(overrides = {}) {
  return {
    route: '/',
    pathname: '/',
    query: {},
    asPath: '/',
    push: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
    beforePopState: vi.fn(),
    events: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
    isFallback: false,
    isLocaleDomain: false,
    isReady: true,
    isPreview: false,
    ...overrides,
  }
}

/**
 * Creates a mock App Router navigation
 */
export function createMockAppRouter(overrides = {}) {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    ...overrides,
  }
}

/**
 * Mocks window.location
 */
export function mockLocation(url = 'http://localhost:3000/') {
  const location = new URL(url)
  Object.defineProperty(window, 'location', {
    value: {
      ...location,
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
    },
    writable: true,
  })
}

/**
 * Mocks localStorage
 */
export function mockLocalStorage() {
  const store: Record<string, string> = {}

  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((key) => delete store[key])
      }),
      length: 0,
      key: vi.fn(),
    },
    writable: true,
  })
}

/**
 * Mocks sessionStorage
 */
export function mockSessionStorage() {
  const store: Record<string, string> = {}

  Object.defineProperty(window, 'sessionStorage', {
    value: {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((key) => delete store[key])
      }),
      length: 0,
      key: vi.fn(),
    },
    writable: true,
  })
}

/**
 * Mocks file upload/drop functionality
 */
export function createMockFile(name: string, type: string, size = 1024) {
  return new File(['test content'], name, { type, lastModified: Date.now() })
}

export function createMockFileList(files: File[]) {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] || null,
    [Symbol.iterator]: function* () {
      yield* files
    },
  }

  files.forEach((file, index) => {
    Object.defineProperty(fileList, index, {
      value: file,
      enumerable: true,
    })
  })

  return fileList as FileList
}

/**
 * Simulates user interactions with better defaults
 */
export function createUserEvent() {
  return {
    click: vi.fn(),
    type: vi.fn(),
    clear: vi.fn(),
    selectOptions: vi.fn(),
    upload: vi.fn(),
    hover: vi.fn(),
    unhover: vi.fn(),
    tab: vi.fn(),
    keyboard: vi.fn(),
  }
}

/**
 * Waits for a specified amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Waits for an element to appear (useful for async operations)
 */
export async function waitForElement(callback: () => void, timeout = 1000) {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    try {
      callback()
      return
    } catch {
      await wait(50)
    }
  }
  throw new Error(`Element not found within ${timeout}ms`)
}

/**
 * Creates mock form data
 */
export function createMockFormData(data: Record<string, string | File>) {
  const formData = new FormData()
  Object.entries(data).forEach(([key, value]) => {
    formData.append(key, value)
  })
  return formData
}

// Re-export testing library utilities
export * from '@testing-library/react'
export * from '@testing-library/user-event'
