import { Link } from 'react-router'
import { buttonClass } from '../components/ui/button'
import { PageTitle, usePageTitle } from '../components/page'

export default function NotFoundPage() {
  usePageTitle('Page not found')
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-16 sm:px-8">
      <PageTitle>Page not found</PageTitle>
      <p className="mt-4 text-lg text-ink-muted">This address doesn’t lead anywhere in SayStreet.</p>
      <Link to="/chat" className={buttonClass('primary', 'md', 'mt-8')}>
        Go to your chats
      </Link>
    </main>
  )
}
