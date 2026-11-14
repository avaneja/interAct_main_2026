/**
 * What the interviewer says around the questions. These lines are known
 * before the call, so their speech is prepared ahead and plays at once,
 * covering the wait while an answer is scored and the next question's
 * speech is made.
 */

const ACKNOWLEDGEMENTS = ['Thank you. Let me note that down.', 'Thanks, got it.', 'Okay, thank you.']

export const STILL_THINKING_LINE = 'Just a moment longer.'
export const CLOSING_LINE = 'That was the last question. Thank you for your time. Your report is ready.'
export const PAUSE_LINE = 'No problem. We can pick this up whenever you are ready.'

export function greetingLine(interviewerName: string, questionCount: number, topic: string | null): string {
  const about = topic ? ` about ${topic}` : ''
  return (
    `Hi, I'm ${interviewerName}. Thanks for joining. I'll ask you ${questionCount} questions${about}. ` +
    'Take your time, and answer as you would in a real interview.'
  )
}

export function welcomeBackLine(interviewerName: string): string {
  return `Welcome back. It's ${interviewerName} again. Let's continue where we left off.`
}

/** Said just before a question: "Here's the first question.", "Here's question 3.", "Here's the last question." */
export function questionIntroLine(sequence: number, questionCount: number): string {
  if (sequence === 1) return "Here's the first question."
  if (sequence === questionCount) return "Here's the last question."
  return `Here's question ${sequence}.`
}

/** A short acknowledgement after an answer, varied so it does not sound repetitive. */
export function acknowledgementLine(sequence: number): string {
  return ACKNOWLEDGEMENTS[(sequence - 1) % ACKNOWLEDGEMENTS.length]
}

/** Said when the call starts, before the next question. */
export function openingLines({
  interviewerName,
  questionCount,
  topic,
  nextSequence,
  resuming,
}: {
  interviewerName: string
  questionCount: number
  topic: string | null
  nextSequence: number
  resuming: boolean
}): string[] {
  return [
    resuming ? welcomeBackLine(interviewerName) : greetingLine(interviewerName, questionCount, topic),
    questionIntroLine(nextSequence, questionCount),
  ]
}

/**
 * Said after the candidate answers question `sequence`, prepared while they
 * are still answering. The voice makes lines one at a time, so only these
 * few are queued, never the whole call's worth.
 */
export function linesAfterAnswer(sequence: number, questionCount: number): string[] {
  const next = sequence < questionCount ? questionIntroLine(sequence + 1, questionCount) : CLOSING_LINE
  return [acknowledgementLine(sequence), STILL_THINKING_LINE, next]
}
