import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SelfView from './SelfView'

const stream = {} as MediaStream

describe('SelfView', () => {
  it('shows when eye contact is being tracked', () => {
    render(<SelfView stream={stream} name="Asha" trackingEyes />)
    expect(screen.getByText('Eye contact tracking on')).toBeInTheDocument()
  })

  it('shows nothing about tracking when it is off', () => {
    render(<SelfView stream={stream} name="Asha" />)
    expect(screen.queryByText('Eye contact tracking on')).not.toBeInTheDocument()
  })

  it('never claims tracking with the camera off', () => {
    render(<SelfView stream={null} name="Asha" trackingEyes />)
    expect(screen.getByText('Camera off')).toBeInTheDocument()
    expect(screen.queryByText('Eye contact tracking on')).not.toBeInTheDocument()
  })
})
