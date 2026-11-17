// Tells company meetings (only Zawadie people) apart from client meetings
// (anyone from another email domain). The other domains also say which client
// it was, e.g. "acme.com".
const env = require('../config/env');

const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';

// The company list holds domains ("zawadie.com") and can also hold full
// addresses ("someone@gmail.com") for people who work with Zawadie on a
// personal email, so they aren't mistaken for a client.
function isCompanyEmail(email, companyDomains = env.COMPANY_DOMAINS) {
  const address = String(email || '').toLowerCase();
  const domain = domainOf(address);
  return Boolean(domain) && (companyDomains.includes(domain) || companyDomains.includes(address));
}

// A meeting with no attendee emails can't be told apart, so it counts as a
// company meeting: nothing in it is attributed to a client.
function classifyMeeting(participantEmails, companyDomains = env.COMPANY_DOMAINS) {
  const externalDomains = [...new Set(
    (participantEmails || []).filter(e => domainOf(e) && !isCompanyEmail(e, companyDomains)).map(domainOf)
  )].sort();
  return { kind: externalDomains.length ? 'client' : 'company', externalDomains };
}

// On these, the domain says nothing about which client it is.
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'msn.com']);

/** Which clients are among these emails: their company domain, or the address itself on free mail. */
function clientKeys(emails, companyDomains = env.COMPANY_DOMAINS) {
  return [...new Set((emails || [])
    .filter(e => !isCompanyEmail(e, companyDomains))
    .map(e => (FREE_MAIL.has(domainOf(e)) ? String(e).toLowerCase() : domainOf(e)))
    .filter(Boolean))];
}

module.exports = { classifyMeeting, isCompanyEmail, domainOf, clientKeys };
