// Seed meeting records. Until the Monday.com Notetaker integration is wired up,
// this array acts as the store of "recorded meetings" that Ombeni AI can search,
// summarize, and pull action items from. Each meeting is analyzed on-demand via
// OpenAI (POST /api/meetings/:id/analyze) rather than pre-baked, so the summary/
// action items you see come from a live model call once you click Analyze.
module.exports = [
  {
    id: 'leadership-sync',
    title: 'Weekly Leadership Sync',
    date: '2026-09-18',
    participants: ['Grace Achieng', 'David Mensah', 'Kwame Boateng', 'Sarah Kimani'],
    project: 'Company Operations',
    transcript: `Grace: Let's start with Q3 delivery performance. David, where are we on the Refugee Talent Program expansion?
David: On track for 40 new placements in Q4. The bottleneck right now is Workspace provisioning for new hires — averaging 6 days, which is too slow.
Kwame: I can take that. I'll fix the Workspace access bottleneck by looking at our provisioning script — I think it's a permissions template issue.
Grace: Good. Next, the Ombeni AI rollout. Sarah, where's the training report?
Sarah: Curriculum is done, trainer assignments are confirmed for all three cohorts. I need until Friday to finish the written report.
Grace: Let's extend the Ombeni AI Training Project deadline to October 3rd to give Sarah room and let us pilot with Client Operations first before company-wide rollout.
David: Agreed. I'll also draft a hiring plan for an additional onboarding specialist in Client Operations — we need the headcount given the provisioning delays.
Grace: One open item — the budget for that hire still needs finance approval, I don't have an answer yet. Let's flag that as unresolved.
Kwame: I'll also schedule a follow-up with our Slack and Monday.com integration partners about API access for Ombeni.`
  },
  {
    id: 'ai-strategy',
    title: 'AI Strategy & Ombeni Rollout Planning',
    date: '2026-09-15',
    participants: ['David Mensah', 'Kwame Boateng', 'Amara Osei'],
    project: 'AI Training Project',
    transcript: `David: Today we're locking the rollout sequence for Ombeni AI. Kwame, what's the integration priority?
Kwame: Slack and Monday.com first — Slack for action-item detection in channels, Monday for task creation. Google Meet summaries come after that once transcripts are reliable.
David: Makes sense. Let's ship Monday.com and Slack integrations before Google Meet summaries. Amara, can you write the onboarding guide for the pilot group?
Amara: Yes, I'll have a draft by next Friday. Should the pilot include the Refugee Talent Program team?
David: Good question — still undecided, let's leave that open until we know the AI Training Project timeline is stable.
Kwame: Before we go company-wide I want a security review — who has access to what data, especially anything client-confidential. I'll draft that checklist by the 18th.
David: Agreed, and let's prepare the pilot group invite list for Client Operations by the 17th.`
  },
  {
    id: 'client-onboarding',
    title: 'Client Onboarding Process Review',
    date: '2026-09-10',
    participants: ['Amara Osei', 'David Mensah', 'John Otieno', 'Mary Wanjiru'],
    project: 'Client Onboarding',
    transcript: `Amara: New clients are waiting an average of 6 days for Workspace provisioning before onboarding can really start. That's the main bottleneck.
John: Agreed, and I still need to finish reviewing the client proposal for the new logistics client — I'll get that done by Wednesday.
Mary: The shared onboarding checklist we piloted with the last cohort cut delays noticeably. I think we should adopt it for every new client starting October.
David: Let's do that. Amara, can you finalize the checklist template by the 19th?
Amara: Yes, and I'll share it with the whole Client Operations team by the 20th once it's final.
Mary: I also want to schedule a partner meeting to walk our referral partners through the new process — I'll get that on the calendar for Monday.
David: Sounds good. Let's revisit this in two weeks and see if the 6-day provisioning number has actually come down.`
  },
  {
    id: 'q4-product-strategy',
    title: 'Q4 Product Strategy & Monday Integration Sync',
    date: '2026-09-05',
    participants: ['John', 'Sarah'],
    project: 'AI Training Project',
    transcript: `John: Welcome everyone. Today we are locking in the architecture for Ombeni AI.
Sarah: Great, I will handle the Monday API scopes and figure out which board the action items should land on.
John: Excellent, and we will deploy on a Hostinger subdomain to start, with OpenAI handling the meeting analysis and chat layer.
Sarah: I'll review the API scope by end of week and report back on what permissions we actually need from Monday.
John: Perfect, let's follow up next week once you've reviewed it.`
  }
];
