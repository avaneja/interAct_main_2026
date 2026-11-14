import { expect, test } from '@playwright/test'

// M3 "done when": a Model A interview runs end to end in the browser.
// Runs against the real backend with the fake LLM (see playwright.config.ts).

const ANSWER =
  'A process is a running program with its own address space, while threads inside it share that memory. ' +
  'The scheduler decides which one runs next, trading fairness against response time for interactive work.'

test('a topic interview runs from the home page to the report', async ({ page }) => {
  // Sessions need a signed-in user; the development sign-in sets the browser's cookie.
  const signIn = await page.request.post('/api/v1/auth/dev/login')
  expect(signIn.status()).toBe(204)

  // Home → topic.
  await page.goto('/')
  await page.getByRole('link', { name: 'Get Started' }).click()
  await expect(page.getByRole('heading', { name: 'What do you want to practise?' })).toBeVisible()

  await page.getByLabel('Topic', { exact: true }).fill('Operating systems')
  await page.getByLabel('Goal (optional)').fill('software engineering internship')
  await page.getByLabel('Your level (optional)').selectOption('intermediate')
  await page.getByLabel('Subtopics to focus on (optional)').fill('processes, memory, scheduling')
  await page.getByRole('button', { name: 'Continue to settings' }).click()

  // Settings → plan.
  await expect(page.getByRole('heading', { name: 'Interview settings' })).toBeVisible()
  await page.getByText('Mixed', { exact: true }).click()
  await page.getByText('Intermediate', { exact: true }).click()
  await page.getByText('5', { exact: true }).click()
  await page.getByRole('button', { name: 'Review the plan' }).click()

  await expect(page.getByRole('heading', { name: 'Review your interview plan' })).toBeVisible()
  const planned = page.getByRole('list').getByRole('listitem')
  await expect(planned).toHaveCount(5)
  await expect(planned.first()).toContainText('processes')
  await expect(planned.first()).toContainText('Direct')
  await expect(planned.last()).toContainText('Application')

  // Confirm and start.
  await page.getByRole('button', { name: 'Confirm and start' }).click()
  await expect(page).toHaveURL(/\/sessions\/[^/]+\/interview$/)
  const interviewUrl = page.url()

  for (let sequence = 1; sequence <= 5; sequence++) {
    await expect(page.getByText(`Question ${sequence} of 5`)).toBeVisible()
    const answer = page.getByLabel('Your answer')

    if (sequence === 2) {
      // A reload mid-answer keeps the draft.
      await answer.fill('Half of my answer')
      await page.reload()
      await expect(page.getByLabel('Your answer')).toHaveValue('Half of my answer')
    }

    if (sequence === 3) {
      // Pause hides the question; resume brings it back.
      await page.getByRole('button', { name: 'Pause' }).click()
      await expect(page.getByRole('heading', { name: 'Interview paused' })).toBeVisible()
      await page.getByRole('button', { name: 'Resume interview' }).click()
      await expect(page.getByText('Question 3 of 5')).toBeVisible()
    }

    await page.getByLabel('Your answer').fill(ANSWER)
    await page.getByRole('button', { name: 'Submit answer' }).click()
  }

  // The last answer opens the report.
  await expect(page).toHaveURL(/\/report$/)
  await expect(page.getByRole('heading', { name: 'Your report: Operating systems' })).toBeVisible()
  await expect(page.getByText(/5 of 5 questions answered/)).toBeVisible()
  await expect(page.getByText('By competency')).toBeVisible()
  await expect(page.getByText('3 of 3 planned areas assessed (100%).')).toBeVisible()

  const firstQuestion = page.locator('details').first()
  await firstQuestion.locator('summary').click()
  await expect(firstQuestion.getByRole('heading', { name: 'Your answer' })).toBeVisible()
  await expect(firstQuestion.getByText(ANSWER)).toBeVisible()
  await expect(firstQuestion.getByText('A stronger answer would cover')).toBeVisible()

  // History lists the finished interview.
  await page.getByRole('link', { name: 'Your interviews' }).click()
  const item = page.getByRole('listitem').filter({ hasText: 'Operating systems' })
  await expect(item).toContainText('Completed')
  await expect(item).toContainText('5 of 5 answered')
  await item.getByRole('link', { name: 'View report' }).click()
  await expect(page).toHaveURL(interviewUrl.replace(/interview$/, 'report'))
})
