import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from './test/renderApp'

describe('routing', () => {
  it('shows a not-found page for an unknown address', () => {
    renderApp('/no/such/page')

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  })

  it('shows the navigation on every page', () => {
    renderApp('/no/such/page')

    expect(screen.getByRole('link', { name: 'InterAct' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'New interview' })).toHaveAttribute('href', '/new')
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/history')
  })
})
