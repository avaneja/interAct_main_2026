import { describe, expect, it } from 'vitest'
import {
  STILL_THINKING_LINE,
  WARM_UP_QUESTION,
  fillerLine,
  goodbyeLine,
  greetingLine,
  linesAfterAnswer,
  openingLines,
  questionIntroLine,
  welcomeBackLine,
} from './script'

describe('what the interviewer says', () => {
  it('greets the candidate by first name, introduces itself, and says what is coming', () => {
    expect(greetingLine('Maya', 'Aayush', 5, 'DSA')).toBe(
      "Hi Aayush, thanks for joining me today. I'm Maya, and I'll be conducting your interview. We'll go through 5 questions about DSA.",
    )
    expect(greetingLine('Maya', null, 10, null)).toBe(
      "Hi, thanks for joining me today. I'm Maya, and I'll be conducting your interview. We'll go through 10 questions.",
    )
  })

  it('opens a new call with the greeting and the warm-up question', () => {
    expect(openingLines({ interviewerName: 'Maya', firstName: 'Ada', questionCount: 5, topic: 'DSA', nextSequence: 1, resuming: false }))
      .toEqual([greetingLine('Maya', 'Ada', 5, 'DSA'), WARM_UP_QUESTION])
  })

  it('opens a resumed call with a welcome back and the next question', () => {
    expect(openingLines({ interviewerName: 'Maya', firstName: 'Ada', questionCount: 5, topic: null, nextSequence: 4, resuming: true }))
      .toEqual([welcomeBackLine('Maya'), "Here's question 4."])
  })

  it('announces the first, middle and last questions when the model gave no lead-in', () => {
    expect(questionIntroLine(1, 5)).toBe("Here's the first question.")
    expect(questionIntroLine(3, 5)).toBe("Here's question 3.")
    expect(questionIntroLine(5, 5)).toBe("Here's the last question.")
  })

  it('varies its short listening sounds', () => {
    const fillers = [1, 2, 3, 4, 5].map(fillerLine)

    expect(new Set(fillers.slice(0, 4)).size).toBe(4)
    expect(fillers[4]).toBe(fillers[0])
  })

  it('prepares a listening sound and a waiting line for after each answer', () => {
    expect(linesAfterAnswer(2)).toEqual([fillerLine(2), STILL_THINKING_LINE])
  })

  it('says goodbye by name when it has one', () => {
    expect(goodbyeLine('Ada')).toBe('Thanks for your time today, Ada. Goodbye.')
    expect(goodbyeLine(null)).toBe('Thanks for your time today. Goodbye.')
  })
})
