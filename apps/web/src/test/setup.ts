// apps/web/src/test/setup.ts

import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import '@testing-library/jest-dom'

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Mock Next.js router
vi.mock('next/router', () => ({
  useRouter: () => ({
    route: '/',
    pathname: '/',
    query: {},
    asPath: '/',
    push: vi.fn(),
    pop: vi.fn(),
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
  }),
}))

// Mock Next.js navigation (App Router)
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useParams: () => ({}),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

// // Mock Next.js Image component
// vi.mock('next/image', () => ({
//   default: (props: any) => {
//     // eslint-disable-next-line @next/next/no-img-element
//     return <img {...props} />
//   },
// }))

// // Mock Next.js Link component
// vi.mock('next/link', () => ({
//   default: ({ children, href, ...props }: any) => {
//     return <a href={href} {...props}>{children}</a>
//   },
// }))

// Mock Next.js dynamic imports
vi.mock('next/dynamic', () => ({
  default: (dynamicFunction: any, options: any) => {
    const Component = dynamicFunction()
    return Component
  },
}))

// Mock environment variables
process.env.NODE_ENV = 'test'
process.env.APP_URL = 'http://localhost:3000'
process.env.NEXT_PUBLIC_ENV = 'development'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

/**
 * Mock ResizeObserver — a real CLASS, not `vi.fn().mockImplementation(...)`.
 *
 * floating-ui's `autoUpdate` does `new ResizeObserver(...)`, and a mock whose
 * implementation returns an object literal is not a valid constructor there, so
 * every Radix popper (dropdown, popover, tooltip content) threw
 * "is not a constructor" the moment it opened. `records-view-request-access.test.tsx`
 * carried a local `NoopResizeObserver` + `vi.stubGlobal` workaround for exactly
 * this; hoisting it here means the next test that opens a menu doesn't have to
 * rediscover it.
 */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = NoopResizeObserver

// jsdom implements none of the Pointer Capture API, which Radix menus call on
// pointer-down. Without these, opening a menu with `userEvent` throws.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock the Web Animations API — jsdom implements none of it. `@base-ui-components`'
// ScrollArea calls `viewport.getAnimations({ subtree: true })` from a timer, so the
// resulting throw lands OUTSIDE any test as an UNHANDLED error, which fails the whole
// run while every assertion in the file still passes. An empty list is what a viewport
// with nothing animating returns.
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => []
}

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
})

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  writable: true,
  configurable: true,
})

// Global test setup
beforeAll(() => {
  // Add any global setup here
})

afterAll(() => {
  // Add any global cleanup here
})
