import { todayIso } from '../learning-store.js'

const observed = ['correct', 'incorrect', 'fuzzy']
const actions = ['review_complete', 'review_add', 'concept', 'exercise', 'exercise_spec', 'attempt', 'mistake', 'task', 'evidence']
const positiveSignals = new Set(['recall_correct', 'exercise_completed', 'explain_correct'])
const nonempty = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
}
export function validateLearningRecord(args, store) {
  if (!args || !actions.includes(args.action)) throw new Error('unknown learning_record action')
  const normalized = { ...args }
  if (args.evidence_ref !== undefined) nonempty(args.evidence_ref, 'evidence_ref')
  if (args.request_id !== undefined) nonempty(args.request_id, 'request_id')
  switch (args.action) {
    case 'review_complete': {
      nonempty(args.review_id, 'review_id')
      if (!observed.includes(args.result)) throw new Error('review_complete requires result: correct, incorrect or fuzzy; repeated-correct tier is derived')
      const state = store.load()
      const item = [...state.review_state.due_items, ...state.review_state.next_review_items]
        .find(item => item?.id === args.review_id)
      if (!item) throw new Error(`review item not found: ${args.review_id}`)
      if (item.due_at > todayIso()) throw new Error(`review item is not due until ${item.due_at}`)
      if (args.result === 'correct') {
        const streak = Number(state.topic_state.concept_progress?.[item.concept]?.correct_streak ?? 0)
        normalized.result = streak >= 2 ? 'third_correct' : streak === 1 ? 'second_correct' : 'correct'
      }
      break
    }
    case 'review_add':
      nonempty(args.concept, 'concept')
      normalized.result = args.result ?? 'incorrect' // scheduling is not proof of correct recall
      if (!observed.includes(normalized.result)) throw new Error('review_add result must be correct, incorrect or fuzzy')
      break
    case 'concept':
      nonempty(args.concept, 'concept')
      if (args.status === 'mastered') throw new Error('direct mastery promotion is not allowed; complete assessed reviews')
      if (args.status !== 'weak') throw new Error('concept requires status: weak')
      break
    case 'exercise':
      nonempty(args.task, 'task')
      if (!['completed', 'failed'].includes(args.exercise_status)) throw new Error('exercise requires exercise_status: completed or failed')
      break
    case 'exercise_spec':
      nonempty(args.task, 'task')
      if (!Array.isArray(args.concepts) || !args.concepts.some(c => typeof c === 'string' && c.trim())) throw new Error('exercise_spec requires concepts')
      break
    case 'attempt':
      nonempty(args.exercise_id, 'exercise_id')
      if (!['pass', 'partial', 'fail'].includes(args.attempt_result)) throw new Error('attempt requires attempt_result')
      if (!Number.isInteger(args.score) || args.score < 0 || args.score > 100) throw new Error('attempt requires an integer score from 0 to 100')
      if (!String(args.answer ?? '').trim() && !String(args.evidence_ref ?? '').trim()) throw new Error('attempt requires answer or evidence_ref')
      if ((args.attempt_result === 'pass' && args.score === 0)
        || (args.attempt_result === 'fail' && args.score === 100)
        || (args.attempt_result === 'partial' && (args.score === 0 || args.score === 100))) throw new Error('attempt_result contradicts score')
      store.exerciseSpec(args.exercise_id)
      break
    case 'mistake':
      if (!((args.concepts ?? []).some(x => typeof x === 'string' && x.trim()) || String(args.concept ?? '').trim())) throw new Error('mistake requires concept or concepts')
      break
    case 'task': nonempty(args.task, 'task'); break
    case 'evidence':
      nonempty(args.signal, 'signal')
      if (positiveSignals.has(args.signal) && (!String(args.evidence_ref ?? '').trim() || !String(args.evaluation_reason ?? '').trim())) throw new Error('positive evidence requires evidence_ref and evaluation_reason')
      break
  }
  return normalized
}
