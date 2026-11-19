/**
 * The interviewer: a name and a HeadTTS voice. The call shows the interviewer
 * with the camera off, so there is no 3D model; only the voice is heard.
 */
export interface InterviewerPreset {
  key: string
  name: string
  voice: string
}

// af_heart is Kokoro's highest-rated English voice: clearer and more fluent than af_bella.
export const INTERVIEWERS: InterviewerPreset[] = [{ key: 'preset-01', name: 'Maya', voice: 'af_heart' }]

export const DEFAULT_INTERVIEWER = INTERVIEWERS[0]
