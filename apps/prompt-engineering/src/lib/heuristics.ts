import type { Criterion } from '../data/types'

export interface ScoreResult {
  score: number
  max: number
  hits: { label: string; met: boolean; points: number }[]
}

export function scoreText(text: string, criteria: Criterion[]): ScoreResult {
  const hits = criteria.map((c) => ({
    label: c.label,
    met: text.trim().length > 0 && c.test(text),
    points: c.points,
  }))
  const score = hits.reduce((sum, h) => sum + (h.met ? h.points : 0), 0)
  const max = criteria.reduce((sum, c) => sum + c.points, 0)
  return { score, max, hits }
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

export const hasMinWords = (min: number) => (text: string) => wordCount(text) >= min

export const containsAny =
  (words: string[]) =>
  (text: string) => {
    const lower = text.toLowerCase()
    return words.some((w) => lower.includes(w.toLowerCase()))
  }

export const hasFormatCue = (text: string) => {
  const lower = text.toLowerCase()
  const cueWords = [
    'list',
    'step',
    'sentence',
    'paragraph',
    'word',
    'bullet',
    'table',
    'short',
    'long',
    'minute',
    'day',
  ]
  return /\d/.test(text) || cueWords.some((w) => lower.includes(w))
}

export const hasRoleCue = (text: string) => {
  const lower = text.toLowerCase()
  return /\b(you are|act as|acting as|as an?\s+\w+,|your role is|as a\b)/.test(lower)
}

const TASK_VERBS = [
  'write',
  'summarize',
  'summarise',
  'explain',
  'list',
  'create',
  'generate',
  'draft',
  'rewrite',
  'translate',
  'compare',
  'classify',
  'plan',
  'design',
  'review',
  'fix',
  'debug',
  'outline',
  'analyze',
  'analyse',
  'identify',
  'recommend',
  'describe',
  'build',
]

export const hasTaskVerb = (text: string) => {
  const lower = text.toLowerCase()
  return TASK_VERBS.some((v) => new RegExp(`\\b${v}\\b`).test(lower))
}

export const hasContextCue = containsAny([
  'context',
  'background',
  'given',
  'here is',
  "here's",
  'the following',
  'audience',
  'for a',
  'for an',
  'who is',
  'so that',
  'because',
  'attached',
])

export const hasConstraintCue = containsAny([
  'must',
  "don't",
  'do not',
  'never',
  'only',
  'avoid',
  'should not',
  "shouldn't",
  'make sure',
  'ensure',
  'constraint',
  'rule',
  'keep it',
  'do not include',
  'without',
])

export interface PromptEvaluationDimension {
  key: 'role' | 'task' | 'context' | 'rules' | 'format' | 'specificity'
  label: string
  weight: number
  met: boolean
  tip: string
}

export interface PromptEvaluation {
  score: number
  band: 'Needs work' | 'Developing' | 'Strong' | 'Excellent'
  dimensions: PromptEvaluationDimension[]
}

/**
 * Scores how a prompt is *constructed* against the RTCRO framework — this app
 * makes no LLM calls, so it can't judge what a model would output for it.
 */
export function evaluatePrompt(text: string): PromptEvaluation {
  const trimmed = text.trim()
  const dimensions: PromptEvaluationDimension[] = [
    {
      key: 'role',
      label: 'Role — gives the AI a persona or expertise',
      weight: 15,
      met: trimmed.length > 0 && hasRoleCue(trimmed),
      tip: 'Open with something like "You are a ..." to set the expertise and voice you want.',
    },
    {
      key: 'task',
      label: 'Task — states a clear, specific action',
      weight: 25,
      met: trimmed.length > 0 && hasTaskVerb(trimmed) && hasMinWords(6)(trimmed),
      tip: 'Use a concrete verb (write, summarize, analyze...) and say exactly what the deliverable is.',
    },
    {
      key: 'context',
      label: 'Context — gives background the AI needs',
      weight: 20,
      met: trimmed.length > 0 && hasContextCue(trimmed),
      tip: 'Add who this is for, why, or paste in the specific facts the AI would otherwise have to guess.',
    },
    {
      key: 'rules',
      label: 'Rules — sets constraints or things to avoid',
      weight: 15,
      met: trimmed.length > 0 && hasConstraintCue(trimmed),
      tip: 'Call out limits explicitly: "do not...", "must...", "avoid...", "only...".',
    },
    {
      key: 'format',
      label: 'Output Format — specifies shape, length, or structure',
      weight: 15,
      met: trimmed.length > 0 && hasFormatCue(trimmed),
      tip: 'Name the exact format: bullet points, a table, a word count, a number of steps.',
    },
    {
      key: 'specificity',
      label: 'Specificity — detailed enough to act on (20+ words)',
      weight: 10,
      met: hasMinWords(20)(trimmed),
      tip: 'Vague, short prompts force the AI to guess. Add the details that matter to you.',
    },
  ]

  const score = Math.round(
    dimensions.reduce((sum, d) => sum + (d.met ? d.weight : 0), 0),
  )

  const band: PromptEvaluation['band'] =
    score >= 85 ? 'Excellent' : score >= 65 ? 'Strong' : score >= 40 ? 'Developing' : 'Needs work'

  return { score, band, dimensions }
}
