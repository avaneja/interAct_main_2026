import { expect, test, type Page } from '@playwright/test'

// M7 "done when": with consent, the report shows focus and delivery numbers,
// and no media leaves the browser. Chrome's fake camera shows a test pattern
// with no face in it, so the face tracker should see no face most of the time.

async function startInterview(page: Page): Promise<string> {
  await page.goto('/')
  expect((await page.request.post('/api/v1/auth/dev/login')).status()).toBe(204)
  const api = page.request
  const session = await (await api.post('/api/v1/sessions', { data: { input_model: 'TOPIC' } })).json()
  const base = `/api/v1/sessions/${session.id}`
  await api.put(`${base}/context`, { data: { input_model: 'TOPIC', topic: 'Databases', subtopics: ['indexes'] } })
  await api.put(`${base}/config`, { data: { question_type: 'DIRECT', difficulty: 'beginner', question_count: 5 } })
  expect((await api.post(`${base}/confirm`)).ok()).toBe(true)
  expect((await api.post(`${base}/start`)).ok()).toBe(true)
  return session.id
}

const ALLOWED = ['answer_seconds', 'spoken', 'tab_switches', 'seconds_away', 'fullscreen_exits', 'camera']
const CAMERA = ['looking_away_ratio', 'look_aways', 'face_missing_ratio', 'multiple_faces_ratio']

test('with consent, answers carry focus numbers only, and the report shows them', async ({ page }) => {
  const id = await startInterview(page)
  const sent: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/answers')) sent.push(request.postDataJSON())
  })
  await page.goto(`/sessions/${id}/interview`)

  await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible()
  await page.getByRole('radio', { name: 'Type my answers' }).check()
  await page.getByRole('checkbox', { name: /Track my focus/ }).check()
  await page.getByRole('button', { name: 'Join interview' }).click()

  // The warm-up, then answer the first question after a few seconds of camera time.
  await page.getByLabel('Your answer').fill('I am a student.')
  await page.getByRole('button', { name: 'Send answer' }).click()
  // The face model warms up now; headless Chrome draws in software, so this can hold the page for seconds.
  await expect(page.getByText('Question 1 of 5', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Send answer' })).toBeVisible()
  // Wait until the face model is running, so the answer has camera time behind it.
  await expect(page.getByText('Eye contact tracking on')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Send answer' })).toBeVisible()
  await page.waitForTimeout(4000)
  await page.getByLabel('Your answer').fill('An index is a sorted structure that speeds up lookups, um, like a B-tree.')
  await page.getByRole('button', { name: 'Send answer' }).click()
  await expect(page.getByText('Question 2 of 5', { exact: true })).toBeVisible()

  // Only the allowed numbers were sent: no video, audio, image or screen content.
  const body = sent[0] as { text: string; delivery: Record<string, unknown> }
  expect(Object.keys(body).sort()).toEqual(['delivery', 'question_id', 'text'])
  expect(ALLOWED).toEqual(expect.arrayContaining(Object.keys(body.delivery)))
  const camera = body.delivery.camera as Record<string, number>
  expect(Object.keys(camera).sort()).toEqual([...CAMERA].sort())
  for (const value of Object.values(camera)) expect(typeof value).toBe('number')
  expect(camera.face_missing_ratio).toBeGreaterThan(0.5)
  expect(JSON.stringify(sent)).not.toMatch(/data:|base64|blob:/)

  // The report has its Delivery and focus section, apart from the score.
  await page.getByRole('button', { name: 'End interview' }).click()
  await page.getByRole('button', { name: 'Yes, end now' }).click()
  await expect(page).toHaveURL(`/sessions/${id}/report`)
  const report = await (await page.request.get(`/api/v1/sessions/${id}/report`)).json()
  expect(report.summary.delivery.answers_measured).toBe(1)
  expect(report.summary.delivery.filler_words).toBe(1)
  expect(report.summary.delivery.camera.face_missing_ratio).toBeGreaterThan(0.5)
})
