import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WaitingNotice from './WaitingNotice'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('waiting notice', () => {
  it('counts the seconds and reassures after a long wait', () => {
    render(<WaitingNotice message="Scoring your answer…" startedAt={Date.now()} />)
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(screen.getByText(/usually takes 10 to 60 seconds/)).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(12_000))
    expect(screen.getByText('12s')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(40_000))
    expect(screen.getByText(/Still working. Local models can be slow/)).toBeInTheDocument()
  })
})
