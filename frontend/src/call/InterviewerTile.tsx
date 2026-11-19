import type { InterviewerActivity } from './CallStage'

const STATUS: Record<InterviewerActivity, string> = {
  speaking: 'Speaking',
  listening: 'Listening',
  thinking: 'Thinking…',
  idle: 'Camera off',
}

/**
 * The interviewer's tile, as in a video call where they keep their camera off:
 * their initial on a bright background, rings that pulse while they speak, and
 * what they are doing. Only their voice is heard.
 */
export default function InterviewerTile({ name, activity = 'idle' }: { name: string; activity?: InterviewerActivity }) {
  const speaking = activity === 'speaking'
  return (
    <div className="bg-call-host relative flex h-full w-full items-center justify-center overflow-hidden rounded-3xl shadow-lg shadow-violet-300/40">
      <div className="relative flex h-28 w-28 items-center justify-center sm:h-36 sm:w-36">
        {speaking && (
          <>
            <span className="animate-speaking absolute inset-0 rounded-full bg-white/40" aria-hidden />
            <span className="animate-speaking absolute inset-0 rounded-full bg-white/30 [animation-delay:0.7s]" aria-hidden />
          </>
        )}
        <span
          className={`relative flex h-full w-full items-center justify-center rounded-full bg-white text-5xl font-bold shadow-xl sm:text-6xl ${
            speaking ? 'ring-4 ring-white/80' : ''
          }`}
        >
          <span className="text-brand">{(name[0] ?? 'I').toUpperCase()}</span>
        </span>
      </div>
      <p className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-800 shadow">
        {name} · AI interviewer
      </p>
      <p
        className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow"
        role="status"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            speaking ? 'bg-emerald-500' : activity === 'listening' ? 'bg-sky-500' : activity === 'thinking' ? 'bg-amber-500' : 'bg-slate-400'
          }`}
          aria-hidden
        />
        {STATUS[activity]}
      </p>
    </div>
  )
}
