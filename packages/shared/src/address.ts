// US shipping address checks (spec 14.5). Same code on the settings form and on the server.

import type { ShippingAddress } from './account'

// 50 states and DC, for the State select: [code, name].
export const US_STATES: readonly (readonly [string, string])[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
]

const STATE_CODES = new Set(US_STATES.map(([code]) => code))

export type AddressField = 'name' | 'line1' | 'line2' | 'city' | 'state' | 'postal' | 'country'

export type AddressCheck =
  | { ok: true; address: ShippingAddress } // trimmed, state upper-cased, empty line2 as null
  | { ok: false; field: AddressField; message: string } // message: shown under the field

export function validateAddress(input: Partial<Record<AddressField, unknown>>): AddressCheck {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '')
  const name = text(input.name)
  const line1 = text(input.line1)
  const line2 = text(input.line2)
  const city = text(input.city)
  const state = text(input.state).toUpperCase()
  const postal = text(input.postal)
  const country = text(input.country || 'US').toUpperCase()

  if (!name || name.length > 100) return fail('name', 'Enter the full name, up to 100 characters.')
  if (!line1 || line1.length > 100) return fail('line1', 'Enter the street address, up to 100 characters.')
  if (line2.length > 100) return fail('line2', 'Keep address line 2 under 100 characters.')
  if (!city || city.length > 100) return fail('city', 'Enter the city, up to 100 characters.')
  if (!STATE_CODES.has(state)) return fail('state', 'Choose a US state.')
  if (!/^\d{5}$/.test(postal)) return fail('postal', 'Enter a 5-digit ZIP code.')
  if (country !== 'US') return fail('country', 'Only US addresses are supported.')

  return { ok: true, address: { name, line1, line2: line2 || null, city, state, postal, country: 'US' } }
}

function fail(field: AddressField, message: string): AddressCheck {
  return { ok: false, field, message }
}
