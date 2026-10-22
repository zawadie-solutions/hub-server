const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');

const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// google-auth-library refreshes the access token automatically (using the
// stored refresh token) whenever it's expired — we don't need to track
// expiry ourselves.
async function getFreshAccessToken(googleTokens) {
  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  client.setCredentials({
    refresh_token: googleTokens.refresh_token,
    access_token: googleTokens.access_token,
    expiry_date: googleTokens.expiry_date
  });
  const { token } = await client.getAccessToken();
  return token;
}

/**
 * Lists the signed-in user's primary-calendar events between timeMin/timeMax
 * (ISO strings). Returns a flat, normalized list — cancelled events dropped.
 */
async function listEventsForRange(googleTokens, timeMinISO, timeMaxISO) {
  const accessToken = await getFreshAccessToken(googleTokens);

  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50'
  });

  const response = await fetch(`${CALENDAR_EVENTS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'Google Calendar API error');
  }

  return (data.items || [])
    .filter(e => e.status !== 'cancelled')
    .map(e => ({
      id: e.id,
      title: e.summary || '(No title)',
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      isAllDay: !e.start.dateTime,
      attendees: (e.attendees || []).map(a => (a.email || '').toLowerCase()).filter(Boolean),
      htmlLink: e.htmlLink || null
    }));
}

module.exports = { listEventsForRange };
