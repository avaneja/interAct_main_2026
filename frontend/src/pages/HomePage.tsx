import { Link } from 'react-router'

const STEPS = [
  {
    title: 'Say what to practise',
    text: 'Describe a topic in your own words, or upload your lecture notes as a PDF or TXT file.',
    tone: 'from-pink-500 to-rose-400',
  },
  {
    title: 'Choose the style',
    text: 'Direct, conceptual, case-based, scenario-based, application or a mix, at your level.',
    tone: 'from-violet-500 to-fuchsia-400',
  },
  {
    title: 'Join the call',
    text: 'Maya asks each question aloud and follows up like a real interviewer. Answer by speaking or typing.',
    tone: 'from-sky-500 to-cyan-400',
  },
  {
    title: 'Read your report',
    text: 'Scores by rubric, what you covered and missed, a stronger answer, and your eye contact and pace.',
    tone: 'from-emerald-500 to-teal-400',
  },
]

const HIGHLIGHTS = [
  { label: 'Voice interview', tone: 'bg-pink-100 text-pink-700' },
  { label: 'Follow-up questions', tone: 'bg-violet-100 text-violet-700' },
  { label: 'Questions from your notes', tone: 'bg-sky-100 text-sky-700' },
  { label: 'Eye-contact feedback', tone: 'bg-emerald-100 text-emerald-700' },
]

export default function HomePage() {
  return (
    <section className="space-y-14">
      <div className="max-w-3xl pt-4">
        <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-1.5 text-sm font-semibold text-violet-700 shadow-sm ring-1 ring-violet-100">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          Practise with an AI interviewer
        </p>
        <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-6xl">
          Practise interviews <span className="text-brand">on any topic</span>
        </h1>
        <p className="mt-5 text-lg text-slate-600 sm:text-xl">
          A spoken interview in the style you choose, with real follow-up questions, then a clear report on what you
          got right and what to work on next.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/new"
            className="bg-brand rounded-full px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-fuchsia-300/60 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
          >
            Get Started
          </Link>
          <Link
            to="/history"
            className="rounded-full bg-white px-7 py-3.5 text-base font-bold text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:bg-violet-50 hover:ring-violet-200"
          >
            Your interviews
          </Link>
        </div>
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="What you get">
          {HIGHLIGHTS.map((item) => (
            <li key={item.label} className={`rounded-full px-3 py-1 text-sm font-semibold ${item.tone}`}>
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="surface p-6 transition hover:-translate-y-1">
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${step.tone} text-lg font-extrabold text-white shadow-md`}
            >
              {index + 1}
            </span>
            <h2 className="mt-4 text-lg font-bold text-slate-900">{step.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.text}</p>
          </li>
        ))}
      </ol>

      <p className="text-sm text-slate-500">Scores are a rubric-based practice estimate, not a hiring decision.</p>
    </section>
  )
}
