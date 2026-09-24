// packages/lib/src/net/__mocks__/safe-fetch.ts

// Picked up by a factory-less `vi.mock('…/net/safe-fetch')`: routes safeFetch to the (stubbed) global fetch.
export const safeFetch = (url: string | URL, init?: RequestInit) => globalThis.fetch(url, init)
