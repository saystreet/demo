// What to try first in an empty chat; they leave with the first message.
export const STARTERS = ['Buy a whistling kettle under $40', 'Where is my kettle?', 'Return my French press']

export function Starters({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {items.map((text) => (
        <li key={text}>
          <button
            type="button"
            onClick={() => onPick(text)}
            className="min-h-11 rounded-full border border-edge px-4 text-base font-semibold hover:border-ink hover:bg-surface-1"
          >
            {text}
          </button>
        </li>
      ))}
    </ul>
  )
}
