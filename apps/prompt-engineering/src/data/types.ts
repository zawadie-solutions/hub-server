// Shared shapes for the course content in modules.ts, exam.ts and badges.ts.

export type ModuleId =
  | 'foundations'
  | 'rtcro'
  | 'reasoning'
  | 'format-control'
  | 'iteration'
  | 'advanced'

export interface Criterion {
  label: string
  points: number
  test: (text: string) => boolean
}

export interface Challenge {
  prompt: string
  placeholder: string
  sampleOutput: string
  modelAnswer: string
  modelAnswerNote: string
  criteria: Criterion[]
}

/** The Role / Task / Context / Rules / Output-format framework taught in Module 2. */
export interface RtcroFramework {
  role: string
  task: string
  context: string
  rules: string
  outputFormat: string
}

export interface Lesson {
  id: string
  title: string
  teach: string[]
  before: string
  after: string
  /** Only set on the RTCRO capstone lesson, where ChallengeCard shows the framework breakdown. */
  framework?: RtcroFramework
  challenge: Challenge
}

export interface ComparisonMetric {
  key: string
  label: string
  description: string
}

export interface ComparisonResponse {
  id: string
  label: string
  text: string
  scores: Record<string, number>
}

/** The "Compare & Score" exercise that closes out every module. */
export interface ResponseComparisonLesson {
  id: string
  title: string
  teach: string[]
  promptShown: string
  metrics: ComparisonMetric[]
  responses: ComparisonResponse[]
  bestResponseId: string
  explanation: string
}

export interface QuizOption {
  id: string
  text: string
}

export interface QuizQuestion {
  id: string
  question: string
  options: QuizOption[]
  correctId: string
  explanation: string
}
