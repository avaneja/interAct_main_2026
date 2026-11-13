import { describe, expect, it } from 'vitest'
import { pathForSession } from './sessionRoutes'

describe('where a session continues', () => {
  it.each([
    ['PREPARING', '/sessions/s-1/topic'],
    ['CONFIGURING', '/sessions/s-1/configure'],
    ['READY', '/sessions/s-1/plan'],
    ['IN_PROGRESS', '/sessions/s-1/interview'],
    ['PAUSED', '/sessions/s-1/interview'],
    ['EVALUATING', '/sessions/s-1/interview'],
    ['COMPLETED', '/sessions/s-1/report'],
  ] as const)('%s continues at %s', (state, path) => {
    expect(pathForSession('s-1', state)).toBe(path)
  })
})
