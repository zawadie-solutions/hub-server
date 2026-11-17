// What a person can do with their own assignment, the same from My Work and
// from Slack: Got it / Not mine / done / reopen, explain it back, and check
// their work. Callers check first that the assignment is theirs.
const workStore = require('../data/workStore');
const checkService = require('./checkService');

const now = () => new Date().toISOString();

const RESPONSES = {
  got_it: (a) => ({ ...a, status: 'confirmed', confirmedAt: now() }),
  done: (a) => ({ ...a, status: 'done', doneAt: now() }),
  reopen: (a) => ({ ...a, status: 'confirmed', doneAt: null })
};

const isResponse = (r) => r === 'not_mine' || Object.prototype.hasOwnProperty.call(RESPONSES, r);

/** Returns the saved assignment, or null after "not_mine" (it's no longer theirs). */
async function respond(assignment, response, email) {
  // A sample was only ever made for this person: giving it back just removes it.
  if (response === 'not_mine' && assignment.sample) {
    await workStore.deleteAssignment(assignment.id);
    return null;
  }
  if (response === 'not_mine') {
    // Back to the meeting's attendees, who can take it. Their own explanation
    // and checks stay private: they don't pass on with the work.
    const declinedBy = [...new Set([...(assignment.declinedBy || []), String(email).toLowerCase()])];
    await workStore.saveAssignment({ ...assignment, ownerEmail: null, status: 'new', declinedBy, slack: null, explained: null, checks: [] });
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(RESPONSES, response)) throw new Error('Unknown response');
  return workStore.saveAssignment(RESPONSES[response](assignment));
}

/** Explain it back. A clean explanation counts as "Got it". Throws if the AI is unavailable. */
async function explain(assignment, text) {
  const result = await checkService.checkExplanation(assignment, text);
  const confirmed = result.ready && assignment.status === 'new';
  const saved = await workStore.saveAssignment({
    ...assignment,
    explained: { text: String(text).slice(0, 4000), result, at: now() },
    ...(confirmed ? { status: 'confirmed', confirmedAt: now() } : {})
  });
  return { assignment: saved, result };
}

const KEEP_CHECKS = 5;

/** Check my work. Only the result is kept, never the work. Throws if the AI is unavailable. */
async function checkWork(assignment, workText, source) {
  const result = await checkService.checkWork(assignment, workText);
  const check = { at: now(), source: String(source || 'What you wrote').slice(0, 200), result };
  const saved = await workStore.saveAssignment({ ...assignment, checks: [check, ...(assignment.checks || [])].slice(0, KEEP_CHECKS) });
  return { assignment: saved, check };
}

module.exports = { respond, isResponse, explain, checkWork };
