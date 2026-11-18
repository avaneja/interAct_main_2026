import { expect, test } from '@playwright/test'

// M9 "done when": a document-based interview shows verified source references.
// Runs against the real backend with the fake LLM (see playwright.config.ts).

const NOTES = [
  'Lecture 5: Evaluating models.',
  'In k-fold cross-validation the data is divided into k folds and each fold is held out once for validation. '.repeat(25),
  'Precision is the share of predicted positives that are truly positive, and recall is the share of positives found. '.repeat(25),
  'The test set is used only once at the end to estimate how the model performs on unseen data. '.repeat(25),
].join('\n\n')

test('an interview from uploaded notes cites the pages its questions come from', async ({ page }) => {
  expect((await page.request.post('/api/v1/auth/dev/login')).status()).toBe(204)
  await page.goto('/new')
  await page.getByRole('link', { name: 'Use your own notes (PDF or TXT)' }).click()

  // Upload, wait while the notes are read, then review the topics they cover.
  await page.getByLabel('Your notes').setInputFiles({ name: 'Lecture 5.txt', mimeType: 'text/plain', buffer: Buffer.from(NOTES) })
  await page.getByRole('button', { name: 'Upload' }).click()
  const topics = page.getByRole('checkbox')
  await expect(topics.first()).toBeVisible({ timeout: 30_000 })
  await expect(topics.first()).toBeChecked()
  await page.getByRole('button', { name: /^Continue with \d+ topics?$/ }).click()

  // The shared settings and plan, as for a topic interview.
  await expect(page.getByRole('heading', { name: 'Interview settings' })).toBeVisible()
  await page.getByText('Direct', { exact: true }).click()
  await page.getByText('Beginner', { exact: true }).click()
  await page.getByText('5', { exact: true }).click()
  await page.getByRole('button', { name: 'Review the plan' }).click()
  await page.getByRole('button', { name: 'Confirm and start' }).click()

  // A short call: the warm-up and one answer, then end it.
  await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible()
  await page.getByRole('radio', { name: 'Type my answers' }).check()
  await page.getByRole('button', { name: 'Join interview' }).click()
  await page.getByLabel('Your answer').fill('I am revising model evaluation.')
  await page.getByRole('button', { name: 'Send answer' }).click()
  await expect(page.getByText('Question 1 of 5', { exact: true })).toBeVisible()
  await page.getByLabel('Your answer').fill('Each fold is held out once while the model trains on the other folds, and the scores are averaged.')
  await page.getByRole('button', { name: 'Send answer' }).click()
  await expect(page.getByText('Question 2 of 5', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'End interview' }).click()
  await page.getByRole('button', { name: 'Yes, end now' }).click()

  // The report: the question's source and its verified quote.
  await expect(page.getByText('Grounded in your document')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/of \d+ questions were checked against your document/)).toBeVisible()
  await page.getByRole('group').first().locator('summary').click()
  await expect(page.getByText(/^From your document/).first()).toBeVisible()
  await expect(page.getByText('Supported by your document').first()).toBeVisible()
})
