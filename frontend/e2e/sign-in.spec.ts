import { expect, test } from '@playwright/test'

// M4 "done when": pages need a signed-in user, and signing out ends access.
// Uses the development sign-in, which the test backend enables; Google and
// GitHub need real accounts, so they are covered by the unit tests instead.

test('a signed-out visitor signs in, returns to their page, and signs out', async ({ page }) => {
  await page.goto('/history')

  await expect(page).toHaveURL('/sign-in?next=%2Fhistory')
  await page.getByRole('button', { name: 'Continue as local test user' }).click()

  await expect(page).toHaveURL('/history')
  await expect(page.getByRole('heading', { name: 'Your interviews' })).toBeVisible()
  await expect(page.getByText('Local test user')).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401)

  await page.goto('/history')
  await expect(page).toHaveURL('/sign-in?next=%2Fhistory')
})
