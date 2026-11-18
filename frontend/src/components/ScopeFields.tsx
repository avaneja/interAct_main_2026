import { DIFFICULTIES } from '../lib/labels'
import { inputClass } from '../lib/styles'
import { type Draft, MAX_TEXT } from '../lib/topicForm'
import { Field } from './ui'

export type DraftErrors = Partial<Record<keyof Draft, string>>

/** What the interview is about: topic, goal, level and subtopics. Used by the topic form and the scope summary. */
export default function ScopeFields({
  draft,
  errors,
  onChange,
  autoFocus = false,
}: {
  draft: Draft
  errors: DraftErrors
  onChange: (field: keyof Draft, value: string) => void
  autoFocus?: boolean
}) {
  return (
    <>
      <Field id="topic" label="Topic" hint="For example: Operating systems, or Machine learning model evaluation." error={errors.topic}>
        <input
          id="topic"
          className={inputClass}
          value={draft.topic}
          onChange={(e) => onChange('topic', e.target.value)}
          maxLength={MAX_TEXT + 50}
          autoFocus={autoFocus}
        />
      </Field>
      <Field id="goal" label="Goal (optional)" hint="For example: a software engineering internship." error={errors.goal}>
        <input id="goal" className={inputClass} value={draft.goal} onChange={(e) => onChange('goal', e.target.value)} />
      </Field>
      <Field id="level" label="Your level (optional)">
        <select id="level" className={inputClass} value={draft.level} onChange={(e) => onChange('level', e.target.value)}>
          <option value="">Not specified</option>
          {DIFFICULTIES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="subtopics"
        label="Subtopics to focus on (optional)"
        hint="Separate with commas. Questions rotate through them. Leave it empty and the interviewer picks the main areas of the topic."
        error={errors.subtopics}
      >
        <textarea
          id="subtopics"
          className={inputClass}
          rows={2}
          value={draft.subtopics}
          onChange={(e) => onChange('subtopics', e.target.value)}
          placeholder="processes, memory management, scheduling"
        />
      </Field>
    </>
  )
}
