/**
 * `learning_record` — The single write path.
 *
 * Every mutation goes through this tool: reviews, concepts, exercises, attempts,
 * mistakes, tasks, and evidence. It reports the delta, not just "ok".
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { EXERCISE_DIFFICULTIES, stableId, todayIso } from '../learning-store.js'
import { LearningAuditStore, auditMetadata, progressSnapshot } from '../audit.js'
import { validateLearningRecord } from '../evaluation/validator.js'
import { SCOPE_PARAM, STATE_FILE_PARAM } from './shared.js'

export function learningRecordTool(service) {
  return defineTool({
    name: 'learning_record',
    description:
      'Record one learning event and persist it: complete a spaced-repetition review, create a review item, ' +
      'mark a concept mastered or weak, log a finished or failed exercise, register an exercise spec, record an ' +
      'exercise attempt, log a mistake or code error, queue a next task, or record a raw difficulty signal. ' +
      'Always use this instead of claiming in prose that state was saved.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      action: {
        type: 'string',
        enum: [
          'review_complete',
          'review_add',
          'concept',
          'exercise',
          'exercise_spec',
          'attempt',
          'mistake',
          'task',
          'evidence',
        ],
        required: true,
        description:
          'review_complete: assess due review (system derives repetition tier). review_add: schedule. concept: mark weak (mastery needs assessed reviews). ' +
          'exercise: log a practice as completed/failed by name, with no ExerciseSpec. ' +
          'exercise_spec: store a generated exercise. attempt: record an answer to a stored exercise. ' +
          'mistake: log a diagnosed error and queue its concepts. task: queue a next task. evidence: record a raw signal.',
      },
      review_id: { type: 'string', description: 'review_complete: the item id from learning_due.' },
      result: {
        type: 'string',
        enum: ['correct', 'incorrect', 'fuzzy'],
        description:
          'Observed recall outcome. The store derives second/third correct from the saved streak; review_add defaults to immediate review.',
      },
      attempt_result: {
        type: 'string',
        enum: ['pass', 'partial', 'fail'],
        description: 'Observed outcome; partial remains partial in stored attempt history.',
      },
      concept: { type: 'string', description: 'review_add / concept / mistake: the concept name.' },
      prompt: { type: 'string', description: 'review_add: the recall question.' },
      status: {
        type: 'string',
        enum: ['mastered', 'weak'],
        description: 'concept: which list the concept belongs in.',
      },
      notes: { type: 'string', description: 'review_complete / task / mistake: free-form notes.' },
      topic: { type: 'string', description: 'exercise_spec: the topic of the exercise.' },
      concepts: {
        type: 'array',
        items: { type: 'string' },
        description: 'exercise_spec / mistake: concepts this event covers.',
      },
      difficulty: {
        type: 'string',
        enum: [...EXERCISE_DIFFICULTIES],
        description: 'exercise_spec: easy, normal, or stretch.',
      },
      task: {
        type: 'string',
        description: 'exercise_spec: the learner-facing task. exercise: the practice name. task: the task to queue.',
      },
      goal: { type: 'string', description: 'exercise_spec: what the exercise tests.' },
      input: {
        type: 'string',
        description: 'exercise_spec: the starting code or material the learner is given.',
      },
      expected_output: { type: 'string', description: 'exercise_spec: expected behavior.' },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'exercise_spec: required boundaries.',
      },
      evaluation_criteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'exercise_spec: how the answer is judged.',
      },
      hint: {
        type: 'string',
        description: 'exercise_spec: one optional hint, hidden until needed.',
      },
      exercise_status: {
        type: 'string',
        enum: ['completed', 'failed'],
        description: 'exercise: whether the learner finished the practice or failed it. Drives the difficulty signal.',
      },
      exercise_id: { type: 'string', description: 'attempt: the id returned by exercise_spec.' },
      answer: {
        type: 'string',
        description: 'attempt: the learner answer, or a faithful summary of it.',
      },
      score: { type: 'number', description: 'attempt: 0-100.' },
      mistake_type: { type: 'string', description: 'attempt / mistake: misconception category.' },
      feedback: { type: 'string', description: 'attempt / mistake: concise evaluator feedback.' },
      signal: {
        type: 'string',
        enum: [
          'exercise_completed',
          'exercise_failed',
          'recall_correct',
          'recall_incorrect',
          'explain_correct',
          'explain_fuzzy',
          'setup_failed',
        ],
        description: 'evidence: raw difficulty signal. Two same-polarity signals in a row move difficulty one step.',
      },
      detail: { type: 'string', description: 'evidence: what the signal refers to.' },
      evidence_ref: { type: 'string', description: 'External answer/test identifier; model-supplied references are not independently verified.' },
      evaluation_reason: { type: 'string', description: 'Short reason for assessment; required with raw positive evidence.' },
      request_id: { type: 'string', description: 'Correlation identifier (not an idempotency key).' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        if (value.ok === false) {
          return [{ type: 'text', text: `记录失败：${value.error}` }]
        }
        const lines = [`已写入 \`${value.path}\`：${value.action}`]
        if (value.review) {
          lines.push(`- 复习项：${value.review.concept} → ${value.review.due_at}（${value.review.result}）`)
        }
        if (value.exercise) {
          lines.push(`- 练习 id：\`${value.exercise.id}\`（${value.exercise.difficulty}）${value.exercise.task}`)
        }
        if (value.attempt) {
          lines.push(`- 尝试：${value.attempt.result}（${value.attempt.score}）${value.attempt.feedback || ''}`)
        }
        if (value.concept_progress) {
          lines.push(
            `- 概念进度 ${value.concept}：strength=${value.concept_progress.strength} streak=${value.concept_progress.correct_streak} failures=${value.concept_progress.failure_count} 下次 ${value.concept_progress.next_due_at}`,
          )
        }
        if (value.difficulty) {
          lines.push(`- 难度：${value.difficulty.current_difficulty}/5（下一步 ${value.difficulty.next_adjustment}）`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta(_args, value) {
        return {
          title: 'learning_record',
          status: value?.ok === false ? 'error' : 'ok',
          action: value?.action ?? '',
          path: value?.path ?? '',
        }
      },
    },
    async execute(args, exec) {
      const binding = service.storeFor({
        stateFile: args.state_file,
        scope: args.scope,
        agent: exec.agent,
      })
      const store = binding.store
      const audit = new LearningAuditStore(binding.path)
      const metadata = auditMetadata(args, binding.path)
      try {
        args = validateLearningRecord(args, store)
      } catch (error) {
        audit.append({ ...metadata, status: 'rejected', error: error instanceof Error ? error.message : String(error) })
        throw error
      }
      const current = store.load()
      const related = [...(args.concepts ?? []), args.concept]
      if (args.action === 'review_complete') {
        related.push([...current.review_state.due_items, ...current.review_state.next_review_items]
          .find(item => item?.id === args.review_id)?.concept)
      }
      if (args.action === 'attempt') related.push(...(store.exerciseSpec(args.exercise_id).concepts ?? []))
      const before = progressSnapshot(current, related)
      audit.append({ ...metadata, status: 'accepted',
        validated_result: args.result ?? args.attempt_result ?? args.exercise_status ?? null, before })
      const payload = { ok: true, path: binding.path, source: binding.source, action: args.action }
      try {
      switch (args.action) {
        case 'review_complete': {
          if (!args.review_id) throw new Error('review_complete requires review_id')
          const result = args.result
          const state = store.completeReview(args.review_id, { result, notes: args.notes ?? '' })
          const history = state.review_state.review_history.at(-1)
          payload.review = {
            id: history.id,
            concept: history.concept,
            prompt: history.prompt,
            result,
            due_at: history.due_at,
          }
          payload.concept = history.concept
          payload.concept_progress = state.topic_state.concept_progress?.[history.concept]
          payload.difficulty = state.difficulty_state
          break
        }
        case 'review_add': {
          if (!args.concept) throw new Error('review_add requires concept')
          const result = args.result
          const prompt = args.prompt ?? `Review ${args.concept}`
          const state = store.addReview(args.concept, prompt, result, 'manual')
          // The store derives the id deterministically, so recomputing it here
          // reads back exactly the row just written rather than guessing.
          const reviewId = stableId('review', args.concept, prompt)
          payload.review =
            state.review_state.next_review_items.find((entry) => entry.id === reviewId) ??
            state.review_state.next_review_items.at(-1)
          payload.concept = args.concept
          payload.concept_progress = state.topic_state.concept_progress?.[args.concept]
          payload.difficulty = state.difficulty_state
          break
        }
        case 'concept': {
          if (!args.concept) throw new Error('concept requires concept')
          if (!args.status) throw new Error('concept requires status')
          const state = store.recordConcept(args.concept, args.status)
          payload.concept = args.concept
          payload.concept_progress = state.topic_state.concept_progress?.[args.concept]
          payload.mastered_concepts = state.topic_state.mastered_concepts
          payload.weak_concepts = state.topic_state.weak_concepts
          break
        }
        case 'exercise': {
          if (!args.task) throw new Error('exercise requires task (the practice name)')
          const status = args.exercise_status
          // The kernel's legacy practice log: an upsert by name, not an
          // ExerciseSpec. It is the only writer of `completed_exercises` /
          // `failed_exercises`, and it emits the exercise_completed /
          // exercise_failed difficulty signal.
          store.recordExercise(args.task, {
            status,
            concepts: args.concepts ?? [],
            notes: args.notes ?? '',
          })
          const after = store.load()
          payload.exercise_status = status
          payload.exercise_record = after.practice_state
          payload.difficulty = after.difficulty_state
          break
        }
        case 'exercise_spec': {
          const topic = args.topic ?? store.load().topic_state.current_topic
          const concepts = args.concepts ?? []
          const difficulty = args.difficulty ?? 'normal'
          const task = args.task ?? ''
          store.addExerciseSpec({
            topic,
            concepts,
            difficulty,
            task,
            goal: args.goal,
            input: args.input ?? '',
            expected_output: args.expected_output ?? '',
            constraints: args.constraints ?? [],
            evaluation_criteria: args.evaluation_criteria ?? [],
            hint: args.hint ?? '',
          })
          // Mirror the store's deterministic id derivation to read the row back.
          const specId = stableId(
            'exercise-spec',
            String(topic ?? '').trim(),
            concepts.map(String).join(','),
            difficulty,
            task.trim(),
          )
          payload.exercise = store.exerciseSpec(specId)
          break
        }
        case 'attempt': {
          if (!args.exercise_id) throw new Error('attempt requires exercise_id')
          if (!args.attempt_result) throw new Error('attempt requires attempt_result (pass, partial, or fail)')
          if (!Number.isInteger(args.score)) throw new Error('attempt requires an integer score from 0 to 100')
          // The store's attempt vocabulary is pass/fail only; `partial` is a
          // model-facing nuance that still counts as a failure for scheduling.
          const attemptResult = args.attempt_result
          const state = store.recordAttempt(args.exercise_id, {
            user_answer: args.answer ?? '',
            result: attemptResult,
            score: args.score,
            mistake_type: args.mistake_type ?? '',
            feedback: args.feedback ?? '',
            concepts_to_review: args.concepts,
          })
          payload.attempt = {
            ...state.practice_state.attempt_records.at(-1),
            outcome: args.attempt_result,
          }
          const firstConcept = (args.concepts ?? [])[0]
          if (firstConcept) {
            payload.concept = firstConcept
            payload.concept_progress = state.topic_state.concept_progress?.[firstConcept]
          }
          payload.difficulty = state.difficulty_state
          break
        }
        case 'mistake': {
          const concepts = (args.concepts ?? (args.concept ? [args.concept] : [])).filter(Boolean)
          if (concepts.length === 0) throw new Error('mistake requires concept or concepts')
          const detail = args.feedback || args.notes || args.mistake_type || ''
          const state = store.load()
          state.practice_state.last_code_errors = [
            ...(state.practice_state.last_code_errors ?? []),
            {
              id: `${Date.now().toString(36)}-${concepts.join('-')}`,
              concept: concepts[0],
              concepts,
              mistake_type: args.mistake_type ?? '',
              detail,
              // Local calendar day, like every other `recorded_at` the kernel
              // writes. A UTC slice would date this record differently from the
              // adjacent evidence rows for the same event.
              recorded_at: todayIso(),
            },
          ].slice(-20)
          store.save(state)
          for (const concept of concepts) {
            store.recordConcept(concept, 'weak')
            store.addReview(concept, `复盘错误：${concept}${detail ? ` — ${detail}` : ''}`, 'incorrect', 'diagnosis')
            store.recordEvidence('explain_fuzzy', `${concept}: ${detail}`)
          }
          payload.concepts = concepts
          payload.difficulty = store.load().difficulty_state
          break
        }
        case 'task': {
          if (!args.task) throw new Error('task requires task')
          const state = store.addTask(args.task, args.notes ?? '')
          payload.task = state.practice_state.current_tasks.at(-1)
          break
        }
        case 'evidence': {
          if (!args.signal) throw new Error('evidence requires signal')
          const state = store.recordEvidence(args.signal, args.detail ?? args.feedback ?? '')
          payload.difficulty = state.difficulty_state
          payload.evidence = state.difficulty_state.evidence.at(-1)
          break
        }
        default:
          throw new Error(`unknown action: ${args.action}`)
      }

      } catch (error) {
        audit.append({ ...metadata, status: 'failed', error: error instanceof Error ? error.message : String(error) })
        throw error
      }
      const after = progressSnapshot(store.load(), related)
      try {
        audit.append({ ...metadata, status: 'committed',
          validated_result: args.result ?? args.attempt_result ?? args.exercise_status ?? null,
          changes: { before, after } })
        payload.audit = { event_id: metadata.event_id, status: 'committed', path: audit.path }
      } catch (error) {
        // The state is already saved. Report pending instead of provoking an unsafe retry.
        payload.audit = { event_id: metadata.event_id, status: 'pending', path: audit.path,
          warning: `state saved but final audit write failed: ${error instanceof Error ? error.message : String(error)}` }
      }
      payload.summary = service.summarize({ stateFile: binding.path, scope: binding.scope })
      return payload
    },
    presentCall(args) {
      return { card: 'generic', title: `learning_record · ${args.action}`, kind: 'write' }
    },
    presentResult(args, result) {
      const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
      return {
        card: 'generic',
        title: `learning_record · ${args.action}`,
        content: text,
        locations: args.state_file ? [{ path: args.state_file }] : undefined,
      }
    },
  })
}
