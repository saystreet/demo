import { useState } from 'react'
import { cn } from '../lib/cn'

// Product photos sit on a light mat (most have white backgrounds). Until a photo arrives the
// tile stays dark, so a slow 2000 px CDN image never shows as a blank glaring square.

type Props = {
  src: string
  alt: string
  size: number
  lazy?: boolean
  className?: string
}

export function ProductImage({ src, alt, size, lazy = true, className }: Props) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      // Not lazy means it's the page's main picture: fetch it first.
      fetchPriority={lazy ? 'low' : 'high'}
      // Switch the mat once the photo is decoded, not just downloaded: a 2000 px image paints late.
      onLoad={(event) => {
        void event.currentTarget
          .decode()
          .catch(() => {})
          .then(() => setLoaded(true))
      }}
      className={cn('aspect-square w-full rounded-(--radius-control) object-contain transition-colors duration-200', loaded ? 'bg-ink' : 'bg-surface-2', className)}
    />
  )
}
