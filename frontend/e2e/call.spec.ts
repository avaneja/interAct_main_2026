import { expect, test, type Page } from '@playwright/test'

// M5 "done when": a full Model A interview runs as a spoken call in Chrome.
// Real speech recognition needs a person and Google's service, so the page
// gets a stand-in that "hears" a fixed sentence each time it listens. The
// rest is real: backend (fake LLM), call page, camera and microphone (fake
// devices), captions and controls. The interviewer speaks in captions only.

const HEARD = 'TCP retransmits lost segments and keeps them in order'

async function fakeSpeechRecognition(page: Page) {
  await page.addInitScript((heard) => {
    class FakeRecognition {
      continuous = false
      interimResults = false
      lang = ''
      onresult: ((event: unknown) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      onend: (() => void) | null = null
      private timers: number[] = []
      start() {
        const words = heard.split(' ')
        // Words arrive a few at a time, first pending, then confirmed.
        this.timers.push(window.setTimeout(() => this.emit(words.slice(0, 4).join(' '), false), 200))
        this.timers.push(window.setTimeout(() => this.emit(heard, true), 500))
      }
      stop() {
        this.timers.forEach((timer) => window.clearTimeout(timer))
        window.setTimeout(() => this.onend?.(), 10)
      }
      abort() {
        this.stop()
      }
      private emit(transcript: string, isFinal: boolean) {
        this.onresult?.({ results: [Object.assign([{ transcript }], { isFinal })] })
      }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition })
  }, HEARD)
}

async function startInterview(page: Page): Promise<string> {
  await page.goto('/')
  expect((await page.request.post('/api/v1/auth/dev/login')).status()).toBe(204)
  const api = page.request
  const session = await (await api.post('/api/v1/sessions', { data: { input_model: 'TOPIC' } })).json()
  const base = `/api/v1/sessions/${session.id}`
  await api.put(`${base}/context`, { data: { input_model: 'TOPIC', topic: 'Computer networks', subtopics: ['routing', 'transport'] } })
  await api.put(`${base}/config`, { data: { question_type: 'DIRECT', difficulty: 'beginner', question_count: 5 } })
  expect((await api.post(`${base}/confirm`)).ok()).toBe(true)
  expect((await api.post(`${base}/start`)).ok()).toBe(true)
  return session.id
}

test('a spoken call: listen, transcribe, review, send, and end early', async ({ page }) => {
  await fakeSpeechRecognition(page)
  const id = await startInterview(page)
  await page.goto(`/sessions/${id}/interview`)

  // The lobby: speaking is offered, the microphone is tested, and the notice says where data goes.
  await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Speak my answers' })).toBeChecked()
  await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible()
  await expect(page.getByText('On. Only you see this preview.')).toBeVisible()
  await expect(page.getByText(/Chrome sends your voice to Google/)).toBeVisible()
  await expect(page.getByLabel('Your camera')).toBeVisible()
  await page.getByRole('button', { name: 'Join interview' }).click()

  // The interviewer asks; then the candidate's words appear in the panel and the caption.
  const controls = page.getByRole('toolbar', { name: 'Call controls' })
  await expect(controls).toBeVisible()
  await expect(page.getByText('Question 1 of 5', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Listening' })).toBeVisible()
  await expect(page.locator('p[aria-live=polite]').filter({ hasText: `You:${HEARD}` })).toBeVisible()

  // Done, fix a word the browser "missed", and send.
  await page.getByRole('button', { name: 'Done answering' }).click()
  const review = page.getByLabel('Check your answer')
  await expect(review).toHaveValue(HEARD)
  await review.fill(`${HEARD} space.`)
  await page.getByRole('button', { name: 'Send answer' }).click()

  // The next question is asked and listened to.
  await expect(page.getByText('Question 2 of 5', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Listening' })).toBeVisible()

  // Muting stops listening; unmuting resumes.
  await controls.getByRole('button', { name: 'Mute microphone' }).click()
  await expect(controls.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'false')
  await controls.getByRole('button', { name: 'Unmute microphone' }).click()

  // Ending early asks first, then opens the report with the one answered question.
  await controls.getByRole('button', { name: 'End interview' }).click()
  await expect(page.getByText(/covers the 1 answered so far/)).toBeVisible()
  await page.getByRole('button', { name: 'Yes, end now' }).click()
  await expect(page).toHaveURL(`/sessions/${id}/report`)
  await expect(page.getByText(/1 of 5 questions answered/)).toBeVisible()

  const answered = page.locator('details').first()
  await answered.locator('summary').click()
  await expect(answered.getByText(`${HEARD} space.`)).toBeVisible()
})
