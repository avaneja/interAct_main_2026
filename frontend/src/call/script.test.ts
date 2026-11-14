import { describe, expect, it } from 'vitest'
import {
  CLOSING_LINE,
  STILL_THINKING_LINE,
  acknowledgementLine,
  greetingLine,
  linesAfterAnswer,
  openingLines,
  questionIntroLine,
  welcomeBackLine,
} from './script'

describe('what the interviewer says', () => {
  it('introduces itself, the number of questions and the topic', () => {
    expect(greetingLine('Maya', 5, 'operating systems')).toBe(
      "Hi, I'm Maya. Thanks for joining. I'll ask you 5 questions about operating systems. " +
        'Take your time, and answer as you would in a real interview.',
    )
    expect(greetingLine('Maya', 10, null)).toContain("I'll ask you 10 questions.")
  })

  it('welcomes the candidate back after a pause or reload', () => {
    expect(welcomeBackLine('Maya')).toBe("Welcome back. It's Maya again. Let's continue where we left off.")
  })

  it('announces the first, middle and last questions', () => {
    expect(questionIntroLine(1, 5)).toBe("Here's the first question.")
    expect(questionIntroLine(3, 5)).toBe("Here's question 3.")
    expect(questionIntroLine(5, 5)).toBe("Here's the last question.")
  })

  it('varies its acknowledgements', () => {
    const lines = [1, 2, 3, 4].map(acknowledgementLine)

    expect(new Set(lines.slice(0, 3)).size).toBe(3)
    expect(lines[3]).toBe(lines[0])
  })

  it('opens a new call with the greeting and the first question', () => {
    expect(openingLines({ interviewerName: 'Maya', questionCount: 3, topic: 'databases', nextSequence: 1, resuming: false })).toEqual([
      greetingLine('Maya', 3, 'databases'),
      "Here's the first question.",
    ])
  })

  it('opens a resumed call with a welcome back and the next question', () => {
    expect(openingLines({ interviewerName: 'Maya', questionCount: 5, topic: null, nextSequence: 4, resuming: true })).toEqual([
      welcomeBackLine('Maya'),
      "Here's question 4.",
    ])
  })

  it('prepares only what follows the current answer', () => {
    expect(linesAfterAnswer(2, 5)).toEqual([acknowledgementLine(2), STILL_THINKING_LINE, "Here's question 3."])
    expect(linesAfterAnswer(5, 5)).toEqual([acknowledgementLine(5), STILL_THINKING_LINE, CLOSING_LINE])
  })
})
