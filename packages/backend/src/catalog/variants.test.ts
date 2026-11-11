import { describe, expect, it } from 'vitest'
import type { C3Product } from './channel3'
import { applySelection, needsSize } from './variants'

const inCategory = (...slugs: string[]) => ({ category: { path: slugs.map((slug) => ({ slug })) } }) as unknown as C3Product

describe('needsSize', () => {
  it('asks for a size on shoes and clothes', () => {
    expect(needsSize(inCategory('apparel-accessories', 'shoes', 'sneakers'))).toBe(true)
    expect(needsSize(inCategory('apparel-accessories', 'clothing', 'shirts'))).toBe(true)
  })
  it('does not ask for a size on watches, jewelry or electronics', () => {
    expect(needsSize(inCategory('apparel-accessories', 'jewelry-watches', 'watches'))).toBe(false)
    expect(needsSize(inCategory('electronics', 'wearable-technology', 'smart-watches'))).toBe(false)
  })
})

describe('applySelection', () => {
  const sizes = { name: 'Size', values: [{ label: '9', product_id: null }, { label: '10', product_id: null }], chosen: null, required: true }
  const typed = { name: 'Size', values: [], chosen: null, required: true }
  const colour = { name: 'Color', values: [{ label: 'Black', product_id: 'abc' }, { label: 'Blue', product_id: 'def' }], chosen: null, required: false }

  it('puts a listed value on its choice, in any letter case', () => {
    expect(applySelection([sizes], [{ name: 'size', value: '10' }])[0]?.chosen).toBe('10')
  })
  it('ignores a value the listing does not have', () => {
    expect(applySelection([sizes], [{ name: 'Size', value: '11' }])[0]?.chosen).toBeNull()
  })
  it('takes what was typed when the listing gives no sizes, cut to 40 characters', () => {
    expect(applySelection([typed], [{ name: 'Size', value: ' 10.5 ' }])[0]?.chosen).toBe('10.5')
    expect(applySelection([typed], [{ name: 'Size', value: 'x'.repeat(80) }])[0]?.chosen).toHaveLength(40)
  })
  it('does not choose a value that is another listing here', () => {
    expect(applySelection([colour], [{ name: 'Color', value: 'Black' }])[0]?.chosen).toBeNull()
  })
  it('changes nothing without a selection', () => {
    expect(applySelection([sizes], undefined)).toEqual([sizes])
  })
})
