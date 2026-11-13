import { Link } from 'react-router'

const STEPS = [
  { title: 'Choose a topic', text: 'Say what you want to practise, your goal and the subtopics to focus on.' },
  { title: 'Pick the style', text: 'Direct, conceptual, case-based, scenario-based, application or a mix.' },
  { title: 'Answer one question at a time', text: 'Take your time; your answers are saved as you go.' },
  { title: 'Read your report', text: 'Scores by rubric, what you covered, what was missing and how to improve.' },
]

export default function HomePage() {
  return (
    <section className="space-y-10">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Practise interviews on any topic</h1>
        <p className="mt-4 text-lg text-slate-300">
          InterAct asks questions in the style you choose, scores each answer against a rubric, and shows you what a
          stronger answer would cover.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/new"
            className="rounded-lg bg-violet-600 px-5 py-3 font-semibold text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            Get Started
          </Link>
          <Link
            to="/history"
            className="rounded-lg border border-slate-700 px-5 py-3 font-semibold text-slate-100 hover:bg-slate-800"
          >
            Your interviews
          </Link>
        </div>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-sm font-semibold text-violet-300">Step {index + 1}</p>
            <h2 className="mt-1 font-semibold text-white">{step.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{step.text}</p>
          </li>
        ))}
      </ol>

      <p className="text-xs text-slate-500">
        Scores are a rubric-based practice estimate, not a hiring decision.
      </p>
    </section>
  )
}
