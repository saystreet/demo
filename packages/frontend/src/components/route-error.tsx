import { useEffect, useRef } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { useAnnouncer } from '../lib/announcer'
import { usePageTitle } from './page'
import { buttonClass } from './ui/button'

// When a page can't load or crashes. Most often after a deploy: an open tab asks for a page file
// that no longer exists (main.tsx reloads once for that; this is the fallback). Says what
// happened, takes focus like any page, and offers the one fix that works: reload.

export function RouteError() {
  const error = useRouteError()
  const heading = useRef<HTMLHeadingElement>(null)
  const { say } = useAnnouncer()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const title = notFound ? 'Page not found' : "This page didn't load"
  usePageTitle(title)

  useEffect(() => {
    console.error(error)
    heading.current?.focus()
    say([`${title}. Reload the page to try again. Nothing was paid.`])
  }, [error, title, say])

  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-16 sm:px-8">
      <h1 ref={heading} tabIndex={-1} className="title text-4xl sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 text-lg text-ink-muted">Reload the page to try again. Nothing was paid, and your chats and orders are safe.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={() => window.location.reload()} className={buttonClass('primary')}>
          Reload the page
        </button>
        <a href="/chat" className={buttonClass('secondary')}>
          Go to your chats
        </a>
      </div>
    </main>
  )
}
