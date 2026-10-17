/**
 * `learning_domain` — Static domain templates; no state required.
 *
 * Answers in a directory that has never had a learner, which is why it reads no
 * state at all.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { teachingProtocolBlock } from '../protocol.js'

export function learningDomainTool(service) {
  return defineTool({
    name: 'learning_domain',
    description:
      'Return the Learning-Accelerator template for a learning domain: focus areas, practice types, review '
      + 'strategy, and the onboarding questions to ask, together with the teaching protocol for that domain. '
      + 'Use it when starting a new track in a domain you have not onboarded into yet.',
    parameters: {
      domain: {
        type: 'string',
        enum: ['general', 'technology', 'language', 'exam', 'writing', 'communication'],
        description: 'The domain to describe. Omit for general.',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        return [{
          type: 'text',
          text: `**领域**：${value.domain}\n`
            + `**重点**：${value.focus_areas.join('、')}\n`
            + `**练习形式**：${value.practice_types.join('、')}\n`
            + `**复习策略**：${value.review_strategy}\n\n`
            + `**Onboarding 问题**\n${value.onboarding_questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}\n\n`
            // This tool works with no state file at all, which is exactly when
            // the prompt-context block is silent. Carrying the method here is
            // what makes "teach me X" in a fresh directory arrive protocol-first.
            + (value.teaching_protocol ?? ''),
        }]
      },
      presentationMeta(_args, value) {
        return { title: 'learning_domain', status: 'ok', domain: value?.domain ?? '' }
      },
    },
    async execute(args) {
      const { LearningStore } = await import('../learning-store.js')
      const template = LearningStore.domainTemplate(args.domain ?? 'general')
      // No state is read here on purpose: this tool must answer in a directory
      // that has never had a learner, so the protocol is composed for the
      // domain with the conservative unknown-profile adaptation.
      return {
        domain: template.domain,
        ...template,
        teaching_protocol: teachingProtocolBlock({ domain: template.domain }),
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_domain', kind: 'read' }
    },
    presentResult(_args, result) {
      const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      return { card: 'generic', title: 'learning_domain', content: text }
    },
  })
}
