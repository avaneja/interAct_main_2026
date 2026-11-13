import { vi } from 'vitest'
import { api } from '../api/client'

/**
 * Use in a test file as:
 *   vi.mock('../api/client', mockApiModule)
 * Every api function becomes a vi.fn(); ApiError stays real.
 */
export async function mockApiModule(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof import('../api/client')
  const mocked = Object.fromEntries(Object.keys(actual.api).map((name) => [name, vi.fn()]))
  return { ...actual, api: mocked }
}

export const mockedApi = api as unknown as { [K in keyof typeof api]: ReturnType<typeof vi.fn> }
