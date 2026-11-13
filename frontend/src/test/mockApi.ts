import { vi, type Mock } from 'vitest'
import type { api } from '../api/client'

/**
 * Replace every api function with a vi.fn(), keeping the real ApiError.
 * vi.mock is hoisted above imports, so load this helper inside the factory:
 *
 *   vi.mock('../api/client', async (importOriginal) =>
 *     (await import('../test/mockApi')).mockApiModule(importOriginal))
 */
export async function mockApiModule(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof import('../api/client')
  const mocked = Object.fromEntries(Object.keys(actual.api).map((name) => [name, vi.fn()]))
  return { ...actual, api: mocked }
}

export type MockedApi = { [K in keyof typeof api]: Mock }
