import { describe, expect, it } from 'vitest'
import { US_STATES, validateAddress } from './address'

const good = { name: 'Alex Morgan', line1: '500 Demo Street', line2: 'Apt 4B', city: 'Austin', state: 'TX', postal: '78701' }

describe('validateAddress', () => {
  it('accepts a full address and cleans it up', () => {
    const result = validateAddress({ ...good, name: '  Alex   Morgan ', state: 'tx', line2: '  ' })
    expect(result).toEqual({
      ok: true,
      address: { name: 'Alex Morgan', line1: '500 Demo Street', line2: null, city: 'Austin', state: 'TX', postal: '78701', country: 'US' },
    })
  })

  it.each([
    ['name', { name: '' }],
    ['line1', { line1: 'x'.repeat(101) }],
    ['line2', { line2: 'x'.repeat(101) }],
    ['city', { city: ' ' }],
    ['state', { state: 'XX' }],
    ['state', { state: 'Texas' }],
    ['postal', { postal: '7870' }],
    ['postal', { postal: '78701-1234' }],
    ['postal', { postal: 'ABCDE' }],
    ['country', { country: 'CA' }],
  ])('rejects bad %s', (field, change) => {
    const result = validateAddress({ ...good, ...change })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.field).toBe(field)
  })

  it('has 50 states and DC', () => {
    expect(US_STATES).toHaveLength(51)
  })
})
