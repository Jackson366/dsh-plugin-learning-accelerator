/**
 * `learning_session` — Onboarding and profile edits.
 *
 * Creates the track or updates the profile, and returns the teaching protocol so
 * the first turn of a new track has the method before any state exists.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { teachingProtocolBlock } from '../protocol.js'
import { SCOPE_PARAM, STATE_FILE_PARAM } from './shared.js'

export function learningSessionTool(service) {
  return defineTool({
    name: 'learning_session',
    description:
      'Start or update a learning track: set the domain, known skills, experience level, goal, target outcome, ' +
      'current topic, constraints, and the next task. Returns the matching onboarding questions from the ' +
      'Learning-Accelerator domain template, plus the teaching protocol adapted to the profile it just saved. ' +
      'Use this for onboarding, or whenever the learner changes goals.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      domain: {
        type: 'string',
        enum: ['general', 'technology', 'language', 'exam', 'writing', 'communication'],
        description: 'Learning domain, which selects the onboarding question set.',
      },
      known_skills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Skills, tools, or prior experience the learner already has.',
      },
      experience_level: {
        type: 'string',
        enum: ['unknown', 'no_programming', 'beginner', 'intermediate', 'advanced'],
        description: 'Declared or inferred experience level. "no_programming" is a valid, expected answer.',
      },
      learning_goal: {
        type: 'string',
        description: 'What the learner wants to achieve, in their own words.',
      },
      target_outcome: {
        type: 'string',
        description: 'The concrete artifact or result that would prove success.',
      },
      current_topic: {
        type: 'string',
        description: 'The single topic this track is on right now.',
      },
      level: {
        type: 'string',
        enum: ['beginner', 'intermediate', 'advanced'],
        description: 'Difficulty level of the current topic.',
      },
      constraint: {
        type: 'string',
        description: 'One constraint to record, such as time budget or forbidden tools.',
      },
      next_task: {
        type: 'string',
        description: 'One concrete next task to queue for the learner.',
      },
      preferred_language: {
        type: 'string',
        description: 'Language to teach in, such as zh-CN or en.',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        const changed = value.changed.length ? value.changed.join('、') : '无'
        const questions = value.onboarding_questions.onboarding_questions
          .map((question, index) => `${index + 1}. ${question}`)
          .join('\n')
        return [
          {
            type: 'text',
            text:
              `已更新学习档案（\`${value.path}\`）：${changed}\n\n` +
              `当前主题：${value.summary.current_topic || '未设置'}　目标：${value.summary.learning_goal || '未设置'}\n\n` +
              `**${value.onboarding_questions.domain} 领域 onboarding 问题**\n${questions}\n\n` +
              '不要一次问完所有问题：从中挑最关键的 1-2 个，先确认背景再开始教。\n\n' +
              // The first turn of a track has no state file yet, so the prompt
              // context is still silent; onboarding is where the method has to
              // arrive instead. Later turns get it injected and can ignore this.
              (value.teaching_protocol ?? ''),
          },
        ]
      },
      presentationMeta(_args, value) {
        return {
          title: 'learning_session',
          status: 'ok',
          path: value?.path ?? '',
          domain: value?.onboarding_questions?.domain ?? '',
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
      const changed = []

      const profile = {}
      if (args.domain) {
        profile.learning_domain = args.domain
        changed.push('domain')
      }
      if (args.known_skills) {
        profile.known_stack = args.known_skills
        profile.known_skills = args.known_skills
        changed.push('known_skills')
      }
      if (args.experience_level) {
        profile.experience_level = args.experience_level
        changed.push('experience_level')
      }
      if (args.learning_goal !== undefined) {
        profile.learning_goal = args.learning_goal
        changed.push('learning_goal')
      }
      if (args.target_outcome !== undefined) {
        profile.target_outcome = args.target_outcome
        changed.push('target_outcome')
      }
      if (args.preferred_language) {
        profile.preferred_language = args.preferred_language
        changed.push('preferred_language')
      }
      if (args.constraint) {
        profile.constraint = args.constraint
        changed.push('constraint')
      }
      if (Object.keys(profile).length > 0) store.updateProfile(profile)

      if (args.current_topic) {
        store.setTopic(args.current_topic, args.level)
        changed.push('current_topic')
      } else if (args.level) {
        store.setTopic(store.load().topic_state.current_topic, args.level)
        changed.push('level')
      }
      if (args.next_task) {
        store.addTask(args.next_task)
        changed.push('next_task')
      }

      const domain = args.domain ?? store.load().learner_profile.learning_domain ?? 'general'
      // Compose from what is now on disk, not from the arguments: a partial
      // update must still produce a protocol that matches the saved profile.
      const saved = store.load().learner_profile ?? {}
      return {
        ok: true,
        path: binding.path,
        source: binding.source,
        changed,
        summary: store.summary(),
        onboarding_questions: store.onboardingQuestions(domain),
        teaching_protocol: teachingProtocolBlock({
          domain,
          experienceLevel: saved.experience_level ?? 'unknown',
          knownSkills: saved.known_skills ?? saved.known_stack ?? [],
        }),
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_session', kind: 'write' }
    },
    presentResult(args, result) {
      const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
      return {
        card: 'generic',
        title: 'learning_session',
        content: text,
        locations: args.state_file ? [{ path: args.state_file }] : undefined,
      }
    },
  })
}
