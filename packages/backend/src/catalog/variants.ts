import type { Choice, ChoiceValue } from '@saystreet/shared'
import type { C3Product } from './channel3'

// Configurations of a product (colour, size, storage, capacity, width…) from Channel3's `variants`,
// the same way for every category. A value with a product_id is another listing (another colour,
// with its own price); one without is a configuration of this listing (a shoe size), and a choice
// whose values are all like that must be made before buying.
//
// Only about one product in five carries variants; without them the option simply has no choices.

// Clothing and shoes are bought in a size, whether or not the listing lists sizes.
const SIZED = /shoe|footwear|sneaker|boot|sandal|apparel|clothing|shirt|pants|jeans|dress|jacket|coat|sweater|hoodie|skirt|shorts|socks|underwear|swimwear/
// "Apparel & Accessories" also holds watches, jewelry and bags: those have no size to say, and asking an
// Apple Watch buyer "which size?" gets "size 10" for "Series 10".
const NOT_SIZED = /watch|jewel|electronic|computer|phone|handbag|luggage|sunglasses|wearable/
export function needsSize(product: C3Product): boolean {
  const path = product.category?.path ?? []
  if (path.some((p) => NOT_SIZED.test(p.slug))) return false
  return path.some((p) => SIZED.test(p.slug))
}

export function choicesFor(product: C3Product): Choice[] {
  const choices = listedChoices(product)
  // A shoe or a shirt whose listing has no sizes: the person says theirs (no list to choose from),
  // and it goes on the order.
  if (needsSize(product) && !choices.some((c) => /size|waist/i.test(c.name))) choices.push({ name: 'Size', values: [], chosen: null, required: true })
  return choices
}

function listedChoices(product: C3Product): Choice[] {
  const byName = new Map<string, Choice>()
  for (const option of product.variants?.options ?? []) {
    const name = option.name?.trim()
    if (!name) continue
    const values: ChoiceValue[] = []
    for (const v of option.values ?? []) {
      const label = v.label?.trim()
      // Junk labels seen in the data: empty, "AttributeValue:{…}", combinations that don't exist.
      if (!label || label.startsWith('AttributeValue:') || v.exists === false) continue
      if (values.some((x) => x.label.toLowerCase() === label.toLowerCase())) continue
      values.push({ label, product_id: v.product_id ?? null })
    }
    const existing = byName.get(name.toLowerCase())
    if (existing) {
      for (const v of values) if (!existing.values.some((x) => x.label.toLowerCase() === v.label.toLowerCase())) existing.values.push(v)
    } else {
      byName.set(name.toLowerCase(), { name, values, chosen: null, required: false })
    }
  }
  const selected = product.variants?.selected ?? []
  const choices = [...byName.values()].filter((c) => c.values.length >= 2)
  for (const choice of choices) {
    const picked = selected.find((s) => s.name?.toLowerCase() === choice.name.toLowerCase())?.label
    // A value pointing to another listing: this listing already is one of them ("This one is Black").
    const linked = choice.values.some((v) => v.product_id)
    choice.chosen = picked && (linked || choice.values.some((v) => v.label === picked)) ? picked : null
    choice.required = !linked && choice.chosen === null
  }
  return choices
}

// ---- Matching what the person said to a value -------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

const UNITS: [RegExp, string][] = [
  [/\b(gigs?|gigabytes?|gig)\b/g, 'gb'],
  [/\b(terabytes?|teras?)\b/g, 'tb'],
  [/\b(quarts?)\b/g, 'qt'],
  [/\b(liters?|litres?)\b/g, 'l'],
  [/\b(ounces?)\b/g, 'oz'],
  [/\b(inches|inch)\b|″|"/g, 'in'],
]

// Colour families: "blue" finds Ultramarine, Navy, Pacific Blue.
const COLOURS: Record<string, string[]> = {
  blue: ['navy', 'cobalt', 'ultramarine', 'azure', 'sky', 'pacific', 'denim', 'indigo', 'sapphire', 'teal', 'aqua', 'turquoise'],
  red: ['crimson', 'scarlet', 'burgundy', 'maroon', 'cherry', 'ruby', 'wine', 'brick'],
  green: ['sage', 'olive', 'mint', 'emerald', 'forest', 'lime', 'jade', 'khaki'],
  gray: ['grey', 'graphite', 'charcoal', 'slate', 'gunmetal', 'ash', 'stone'],
  black: ['midnight', 'onyx', 'jet', 'ebony', 'space', 'obsidian'],
  white: ['ivory', 'cream', 'starlight', 'pearl', 'snow', 'alabaster', 'chalk'],
  pink: ['rose', 'blush', 'coral', 'fuchsia', 'magenta', 'salmon'],
  purple: ['lavender', 'violet', 'lilac', 'plum', 'mauve', 'orchid'],
  yellow: ['mustard', 'lemon', 'butter', 'canary'],
  brown: ['tan', 'beige', 'chocolate', 'coffee', 'camel', 'taupe', 'mocha', 'espresso', 'walnut'],
  orange: ['rust', 'peach', 'apricot', 'tangerine', 'copper'],
  silver: ['chrome', 'steel', 'platinum'],
  gold: ['brass', 'champagne'],
}

export function normalise(text: string): string {
  let t = ` ${text.toLowerCase().replace(/[^a-z0-9.½ ]+/g, ' ')} `
  // "the red one", "that one": the "one" is a pronoun, not a size.
  t = t.replace(/\b(the|this|that)\s+one\b/g, ' ').replace(/\b([a-z]{3,})\s+one\b/g, (m, w: string) => (w in NUMBER_WORDS || w === 'size' ? m : w))
  // Clothing sizes said as words: "medium" → m, "extra large" → xl, "double extra large" → xxl.
  t = t
    .replace(/\b(double|2)\s*(extra|x)\s*-?\s*large\b/g, ' xxl ')
    .replace(/\b(double|2)\s*(extra|x)\s*-?\s*small\b/g, ' xxs ')
    .replace(/\bextra\s*-?\s*large\b/g, ' xl ')
    .replace(/\bextra\s*-?\s*small\b/g, ' xs ')
    .replace(/\bsmall\b/g, ' s ')
    .replace(/\bmedium\b/g, ' m ')
    .replace(/\blarge\b/g, ' l ')
  t = t.replace(/½/g, '.5').replace(/\s+and a half\b/g, '.5').replace(/\s+half\b/g, '.5')
  for (const [pattern, unit] of UNITS) t = t.replace(pattern, ` ${unit} `)
  // "twenty six" → 26, "ten" → 10
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a: string, b: string) => String(NUMBER_WORDS[a]! + NUMBER_WORDS[b]!))
  t = t.replace(/\b[a-z]+\b/g, (w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w))
  t = t.replace(/(\d)\s+\.5\b/g, '$1.5') // "10 .5" → 10.5
  t = t.replace(/(\d+(?:\.\d+)?)\s+(gb|tb|qt|l|oz|in)\b/g, '$1$2') // "256 gb" → 256gb
  return t.replace(/\b(size|the|one|in|colou?r|a|an|please|version|model)\b/g, ' ').replace(/\s+/g, ' ').trim()
}

const tokens = (t: string) => t.split(' ').filter(Boolean)
const numbersIn = (t: string) => tokens(t).filter((w) => /^\d+(\.\d+)?$/.test(w))

function family(word: string): string | null {
  if (word in COLOURS) return word
  for (const [base, shades] of Object.entries(COLOURS)) if (shades.includes(word)) return base
  return null
}

function score(label: string, said: string): number {
  const l = normalise(label)
  const s = said
  if (!s) return 0
  if (l === s) return 4
  const lt = new Set(tokens(l))
  const st = tokens(s)
  // Sizes and storage: the number must match a whole token ("10" never matches "10.5").
  const nums = numbersIn(s)
  if (nums.length && nums.every((n) => lt.has(n) || [...lt].some((x) => x.replace(/[a-z]+$/, '') === n && x !== n && /\d[a-z]+$/.test(x)))) {
    return st.every((w) => lt.has(w) || nums.includes(w)) ? 3 : 2.5
  }
  if (nums.length) return 0
  if (st.every((w) => lt.has(w))) return 2
  const fam = st.map(family).find(Boolean)
  if (fam && [...lt].some((w) => family(w) === fam)) return 1
  return 0
}

export type Match = { value: ChoiceValue; choice: Choice } | { ambiguous: { choice: Choice; values: ChoiceValue[] } } | null

// The value the person meant, across all of an option's choices; ties are asked back.
export function matchValue(choices: Choice[], said: string): Match {
  // A size with no list (the listing doesn't say): whatever size the person said.
  const open = choices.find((c) => c.values.length === 0)
  if (open && choices.every((c) => c === open || c.values.length === 0)) {
    const size = normalise(said).toUpperCase()
    return size ? { value: { label: size, product_id: null }, choice: open } : null
  }
  const s = normalise(said)
  let best = 0
  let found: { value: ChoiceValue; choice: Choice }[] = []
  for (const choice of choices) {
    for (const value of choice.values) {
      const sc = score(value.label, s)
      if (sc > best) {
        best = sc
        found = [{ value, choice }]
      } else if (sc === best && sc > 0) {
        found.push({ value, choice })
      }
    }
  }
  if (best === 0) return null
  if (found.length === 1) return found[0]!
  return { ambiguous: { choice: found[0]!.choice, values: found.map((f) => f.value).slice(0, 5) } }
}

// ---- Saying the choices briefly ---------------------------------------------------------------

const ORDERED = [
  ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'],
  ['twin', 'twin xl', 'full', 'queen', 'king', 'california king'],
]

// "sizes 7 to 15, with half sizes", "S to XL", "in 5 colours", "in Queen or King".
export function choiceSummary(choice: Choice): string {
  const name = choice.name.toLowerCase()
  if (choice.values.length === 0) return `any ${name}`
  const labels = choice.values.map((v) => v.label)
  const nums = labels.map((l) => Number(l.replace(/^[^\d]*/, '').split(/\s/)[0])).filter((n) => Number.isFinite(n) && n > 0)
  const plural = name.endsWith('s') ? name : `${name}s`
  if (labels.length <= 3) return `${choice.required ? `${plural}: ` : 'in '}${labels.slice(0, -1).join(', ')}${labels.length > 1 ? ' or ' : ''}${labels.at(-1)}`
  if (nums.length === labels.length) {
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    const halves = nums.some((n) => !Number.isInteger(n))
    return `${plural} ${min} to ${max}${halves ? ', with half sizes' : ''}`
  }
  for (const order of ORDERED) {
    const idx = labels.map((l) => order.indexOf(l.toLowerCase())).filter((i) => i >= 0)
    if (idx.length === labels.length) return `${plural} ${labels[labels.findIndex((l) => order.indexOf(l.toLowerCase()) === Math.min(...idx))]} to ${labels[labels.findIndex((l) => order.indexOf(l.toLowerCase()) === Math.max(...idx))]}`
  }
  if (name === 'color' || name === 'colour') return `in ${labels.length} colours`
  return `${labels.length} ${plural}`
}

// Every value, for "which sizes?" (long lists cut at 12).
export function choiceList(choice: Choice): string {
  if (choice.values.length === 0) return choice.chosen ? choice.chosen : "any you say (the listing doesn't list them)"
  const labels = choice.values.map((v) => v.label)
  const shown = labels.slice(0, 12)
  return `${shown.slice(0, -1).join(', ')}${shown.length > 1 ? ' or ' : ''}${shown.at(-1)}${labels.length > 12 ? `, and ${labels.length - 12} more` : ''}`
}

// "size 10", "size ten and a half", "size M" in a search: taken out of the query (Channel3 would
// match "10" as a model number) and applied to the options' size choice instead.
export function sizeFromQuery(query: string): { query: string; size: string | null } {
  const m = query.match(/\bsize\s+((?:\d{1,2}(?:\.5)?)|(?:[a-z]+(?:\s+and a half)?)|x{0,3}[sml]|xl)\b/i)
  if (!m) return { query, size: null }
  const raw = m[1]!
  const size = normalise(raw) || raw
  return { query: query.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), size }
}

// The choices made on a card ("Size" → "10") put on the option's own choices. A listed value must be one of
// its values; a choice with no list (a shoe size the listing doesn't give) takes what was typed, trimmed
// and cut short. A value that is another listing (a colour with its own price) is not chosen here: the card
// sends that listing's own product. Anything else is ignored, and a required choice left empty stays so.
export function applySelection(choices: Choice[], selection: { name: string; value: string }[] | undefined): Choice[] {
  if (!selection?.length) return choices
  return choices.map((choice) => {
    const said = selection.find((s) => s.name.toLowerCase() === choice.name.toLowerCase())?.value?.trim()
    if (!said) return choice
    if (choice.values.length === 0) return { ...choice, chosen: said.slice(0, 40) }
    const match = choice.values.find((v) => v.label.toLowerCase() === said.toLowerCase() && !v.product_id)
    return match ? { ...choice, chosen: match.label } : choice
  })
}
