import { cn } from '../lib/cn'

// The SayStreet mark: a Braille cell where dots 2, 3 and 4 (lit) spell S.
// Still in the logo; the lit dots pulse while listening and step while thinking.

type Props = { mode?: 'still' | 'listen' | 'think'; className?: string; dim?: string }

const LIT = [
  { cx: 6, cy: 15, delay: 0 }, // dot 2
  { cx: 6, cy: 24, delay: 0.15 }, // dot 3
  { cx: 16, cy: 6, delay: 0.3 }, // dot 4
]
const UNLIT = [
  { cx: 6, cy: 6 }, // dot 1
  { cx: 16, cy: 15 }, // dot 5
  { cx: 16, cy: 24 }, // dot 6
]

export function BrailleCell({ mode = 'still', className, dim = 'opacity-30' }: Props) {
  const animation = mode === 'listen' ? 'cell-listen 1.1s ease-in-out infinite' : mode === 'think' ? 'cell-think 1.2s ease-in-out infinite' : undefined
  return (
    <svg viewBox="0 0 22 30" aria-hidden="true" className={cn('shrink-0', className)}>
      {UNLIT.map((dot) => (
        <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r={3.2} fill="currentColor" className={dim} />
      ))}
      {LIT.map((dot) => (
        <circle
          key={`${dot.cx}-${dot.cy}`}
          cx={dot.cx}
          cy={dot.cy}
          r={3.2}
          fill="currentColor"
          style={animation ? { animation, animationDelay: `${dot.delay}s`, transformOrigin: `${dot.cx}px ${dot.cy}px` } : undefined}
        />
      ))}
    </svg>
  )
}
