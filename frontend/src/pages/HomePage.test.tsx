import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'

describe('home page', () => {
  it('Get Started opens a new interview', async () => {
    const router = renderApp('/')

    await userEvent.setup().click(screen.getByRole('link', { name: 'Get Started' }))

    expect(router.state.location.pathname).toBe('/new')
  })

  it('links to past interviews', () => {
    renderApp('/')

    expect(screen.getByRole('link', { name: 'Your interviews' })).toHaveAttribute('href', '/history')
  })

  it('says scores are a practice estimate', () => {
    renderApp('/')

    expect(screen.getByText(/practice estimate, not a hiring decision/)).toBeInTheDocument()
  })
})
