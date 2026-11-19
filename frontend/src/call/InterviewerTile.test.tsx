import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InterviewerTile from './InterviewerTile'

describe('the interviewer’s tile (camera off, voice only)', () => {
  it('shows the interviewer’s initial and name, with no video', () => {
    const { container } = render(<InterviewerTile name="Maya" />)

    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('Maya · AI interviewer')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Camera off')
    expect(container.querySelector('video, canvas')).toBeNull()
  })

  it.each([
    ['speaking', 'Speaking'],
    ['listening', 'Listening'],
    ['thinking', 'Thinking…'],
  ] as const)('says when the interviewer is %s', (activity, label) => {
    render(<InterviewerTile name="Maya" activity={activity} />)
    expect(screen.getByRole('status')).toHaveTextContent(label)
  })

  it('pulses only while speaking', () => {
    const { container, rerender } = render(<InterviewerTile name="Maya" activity="speaking" />)
    expect(container.querySelectorAll('.animate-speaking')).toHaveLength(2)

    rerender(<InterviewerTile name="Maya" activity="listening" />)
    expect(container.querySelectorAll('.animate-speaking')).toHaveLength(0)
  })
})
