// Single source of truth for every solution the hub knows about: how it is
// served (proxied `target`, built-in `load`, or `externalUrl`), its card
// copy, and the icon shown for it. Attendance Tracking System is
// intentionally absent — it's a desktop app, not a web app, and was pulled
// from the hub for now.

module.exports = [
  {
    id: 'ombeni-ai',
    name: 'Ombeni AI',
    category: 'Company Assistant',
    description:
      "Zawadie's standalone AI employee — a company assistant that answers questions and gets work done by plugging into calendar, Slack, and Monday.com.",
    status: 'available',
    // Built in: runs inside the hub's own process (apps/ombeni-ai). Its
    // settings are the OMBENI_-prefixed ones in the hub's .env.
    load: () => import('./apps/ombeni-ai/hub.js'),
    icon: 'bot',
  },
  {
    id: 'prompt-engineering',
    name: 'Prompt Engineering',
    category: 'Internal Training',
    description:
      'Zawadie PromptClass — internal prompt-engineering training for Zawadie Solutions agents, with lessons, exams, progress tracking, and a leaderboard.',
    status: 'available',
    // Built in: runs inside the hub's own process (apps/prompt-engineering);
    // its data stays in Neon Postgres (PROMPT_ENGINEERING_DATABASE_URL).
    load: () => import('./apps/prompt-engineering/hub.ts'),
    icon: 'cap',
  },
  // Face-match-system is intentionally absent — it's a Python/FastAPI
  // (uvicorn) service, and Hostinger's Unlimited plan only runs Node.js Web
  // Apps, not arbitrary Python processes. Revisit once it has a host that
  // can run it (e.g. a VPS).
  {
    id: 'google-review-monitor',
    name: 'Google Review Monitor',
    category: 'Operations',
    description:
      'Watches Google review links tracked in Asana and flags when one disappears, so a bad review being removed by its author never goes unnoticed.',
    // Still being built out (see google-review-monitor/README.md) — listed
    // so the team can see it coming, but not yet promoted to "available".
    status: 'development',
    // Built in: runs inside the hub's own process (apps/google-review-monitor),
    // so there is no separate server to start. Configured from the hub's .env.
    load: () => import('./apps/google-review-monitor/src/hub.ts'),
    icon: 'star',
  },
  {
    id: 'company-research',
    name: 'Company Research',
    category: 'Sales & Leads',
    description:
      'Turns a list of company names into evidence-backed lead records — website, owner, phone and email — plus domain search, email finder and verification, with Excel export.',
    status: 'available',
    // Built in: the Node port of the original Python app, running inside the
    // hub's own process (apps/company-research) with its data in MySQL.
    load: () => import('./apps/company-research/src/hub.ts'),
    icon: 'search',
  },
  {
    id: 'bam-comment-review',
    name: 'BAM Comment Review',
    category: 'Social Media',
    description:
      'Reviews and manages comments on our locations’ social pages, with AI-drafted replies and an admin portal for staff.',
    status: 'available',
    // Hosted separately on Vercel, so the hub just links out to it instead
    // of proxying a local server.
    externalUrl: 'https://cm-system-sable.vercel.app/',
    icon: 'chat',
  },
];
