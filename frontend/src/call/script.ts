/**
 * The fixed lines the interviewer says around the questions. Its reactions
 * to answers, follow-ups, transitions and the warm-up and closing replies
 * come from the model; these lines are known before the call, so their
 * speech is made ahead and plays at once.
 */

const FILLERS = ['Okay.', 'Mm-hm.', 'Right.', 'I see.']

export const WARM_UP_QUESTION = 'To start, can you tell me a little bit about yourself?'
export const STILL_THINKING_LINE = 'Just a moment.'
export const WRAP_UP_LINE = 'Okay, those are all of the questions I had for today. Do you have any questions for me?'
export const END_EARLY_LINE = "No problem, let's stop here. I'll put your report together."
export const PAUSE_LINE = 'No problem. We can pick this up whenever you are ready.'

export function greetingLine(interviewerName: string, firstName: string | null, questionCount: number, topic: string | null): string {
  const hello = firstName ? `Hi ${firstName}, thanks for joining me today.` : 'Hi, thanks for joining me today.'
  const about = topic ? ` about ${topic}` : ''
  return `${hello} I'm ${interviewerName}, and I'll be conducting your interview. We'll go through ${questionCount} questions${about}.`
}

export function welcomeBackLine(interviewerName: string): string {
  return `Welcome back. It's ${interviewerName} again. Let's continue where we left off.`
}

export function goodbyeLine(firstName: string | null): string {
  return firstName ? `Thanks for your time today, ${firstName}. Goodbye.` : 'Thanks for your time today. Goodbye.'
}

/** Said before a question when there is no reaction or transition from the model. */
export function questionIntroLine(sequence: number, questionCount: number): string {
  if (sequence === 1) return "Here's the first question."
  if (sequence === questionCount) return "Here's the last question."
  return `Here's question ${sequence}.`
}

/** A short sound of listening straight after an answer, while the reply is being thought out. */
export function fillerLine(turn: number): string {
  return FILLERS[(turn - 1) % FILLERS.length]
}

/** Said when the call starts: a greeting and the warm-up question, or a welcome back. */
export function openingLines({
  interviewerName,
  firstName,
  questionCount,
  topic,
  nextSequence,
  resuming,
}: {
  interviewerName: string
  firstName: string | null
  questionCount: number
  topic: string | null
  nextSequence: number
  resuming: boolean
}): string[] {
  if (resuming) return [welcomeBackLine(interviewerName), questionIntroLine(nextSequence, questionCount)]
  return [greetingLine(interviewerName, firstName, questionCount, topic), WARM_UP_QUESTION]
}

/** Prepared while the candidate answers, so they play the moment the answer is sent. */
export function linesAfterAnswer(turn: number): string[] {
  return [fillerLine(turn), STILL_THINKING_LINE]
}
