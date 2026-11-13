import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <section className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-semibold text-white">Page not found</h1>
      <p className="mt-2 text-slate-400">This address does not match any InterAct page.</p>
      <Link to="/" className="mt-6 inline-block text-violet-400 hover:text-violet-300">
        Go to the home page
      </Link>
    </section>
  )
}
