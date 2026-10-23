// Badge ids here are referenced directly from src/store/progress.tsx
// (`${moduleId}-graduate`, 'rtcro-master', 'response-scorer', 'certified',
// 'prompt-evaluator') — keep ids in sync with awardBadge() calls there.

export interface BadgeDef {
  id: string
  name: string
  description: string
}

export const BADGES: BadgeDef[] = [
  {
    id: 'foundations-graduate',
    name: 'Foundations Graduate',
    description: 'Completed every lesson in Module 1: Foundations of Prompting.',
  },
  {
    id: 'rtcro-graduate',
    name: 'RTCRO Graduate',
    description: 'Completed every lesson in Module 2: The RTCRO Framework.',
  },
  {
    id: 'reasoning-graduate',
    name: 'Reasoning Graduate',
    description: 'Completed every lesson in Module 3: Guided Reasoning.',
  },
  {
    id: 'format-control-graduate',
    name: 'Format Control Graduate',
    description: 'Completed every lesson in Module 4: Output Control & Formatting.',
  },
  {
    id: 'iteration-graduate',
    name: 'Iteration Graduate',
    description: 'Completed every lesson in Module 5: Iterating and Debugging Prompts.',
  },
  {
    id: 'advanced-graduate',
    name: 'Advanced Graduate',
    description: 'Completed every lesson in Module 6: Advanced Techniques & Guardrails.',
  },
  {
    id: 'rtcro-master',
    name: 'RTCRO Master',
    description: 'Scored full marks writing a complete Role-Task-Context-Rules-Output prompt.',
  },
  {
    id: 'response-scorer',
    name: 'Sharp Eye',
    description: 'Scored 15+ points rating AI responses in a Compare & Score exercise.',
  },
  {
    id: 'prompt-evaluator',
    name: 'Self-Reviewer',
    description: 'Scored one of your own prompts with the Evaluate tool.',
  },
  {
    id: 'certified',
    name: 'Zawadie PromptClass Certified',
    description: 'Passed the final exam and earned your certificate.',
  },
]

export function getBadge(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id)
}
