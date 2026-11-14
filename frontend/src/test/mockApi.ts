import { vi, type Mock } from 'vitest'
import type { api } from '../api/client'
import { makeUser } from './fixtures'

/**
 * Replace every api function with a vi.fn(), keeping the real ApiError and
 * the rest of the module. Pages start signed in as makeUser(); a test can
 * sign out with `mockedApi.me.mockRejectedValue(new ApiError(401, '...'))`.
 * vi.mock is hoisted above imports, so load this helper inside the factory:
 *
 *   vi.mock('../api/client', async (importOriginal) =>
 *     (await import('../test/mockApi')).mockApiModule(importOriginal))
 */
export async function mockApiModule(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof import('../api/client')
  const mocked: Record<string, Mock> = Object.fromEntries(Object.keys(actual.api).map((name) => [name, vi.fn()]))
  mocked.me = vi.fn(() => Promise.resolve(makeUser()))
  return { ...actual, api: mocked }
}

export type MockedApi = { [K in keyof typeof api]: Mock }
