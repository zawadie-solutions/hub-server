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
    // Hosted separately on Vercel while it's being rebuilt here, so the hub
    // just links out to it instead of running the in-progress built-in version.
    externalUrl: 'https://promtkit.vercel.app/',
    icon: 'cap',
  },
  {
    id: 'face-match',
    name: 'Face Match',
    category: 'Verification',
    description:
      'Compares a reference photo with one or more newer photos of a person and says whether they are the same person, even across years of ageing. Photos are checked in memory and never stored.',
    status: 'available',
    // Built in: the Node port of the original Python/FastAPI app (apps/face-match), running inside
    // the hub's own process. The face models load on first use, not at hub start.
    load: () => import('./apps/face-match/src/hub.js'),
    icon: 'scan',
  },
  {
    id: 'google-review-monitor',
    name: 'Google Review Monitor',
    category: 'Operations',
    description:
      'Watches Google review links tracked in Asana and flags when one disappears, so a bad review being removed by its author never goes unnoticed.',
    status: 'available',
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
    id: 'bam-local-agent',
    name: 'BAM Local Agent',
    category: 'Marketing',
    description:
      "Turns the BAM quarterly marketing playbook into a plan tailored to each store's demographics, schools and local events, with an admin portal for managing playbooks and store knowledge.",
    status: 'available',
    // Built in: runs inside the hub's own process (apps/bam-local-agent), same as the other
    // built-ins below — no separate process to start or keep alive. The hub's signed identity
    // header (signHubIdentity) is trusted by the app when it has the same ZAWADIE_SSO_SECRET, so
    // hub admins get the admin portal and any other user with this project gets the marketing
    // planner without a second password; the app's own ADMIN_API_KEY/TEAM_ACCESS_KEY remain the
    // fallback when it is run standalone with `npm start` in that folder.
    load: () => import('./apps/bam-local-agent/hub.js'),
    icon: 'bot',
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
