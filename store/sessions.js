// Keeps sign-ins in MySQL. express-session's default store holds them in
// memory, so any restart or redeploy would sign everyone out.
const session = require('express-session');
const { query } = require('./db');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS hub_sessions (
    sid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    data MEDIUMTEXT NOT NULL,
    expires BIGINT NOT NULL,
    KEY hub_sessions_expires (expires)
  )`;

function pruneExpired() {
  return query('DELETE FROM hub_sessions WHERE expires <= ?', [Date.now()]);
}

// Safe to call every boot.
async function init() {
  await query(CREATE_TABLE);
  await pruneExpired();
  setInterval(() => {
    pruneExpired().catch((err) => console.error('[sessions] Could not remove expired sign-ins:', err.message));
  }, PRUNE_EVERY_MS).unref();
}

function respond(promise, callback) {
  promise.then(
    (value) => callback && callback(null, value),
    (err) => callback && callback(err)
  );
}

class MysqlSessionStore extends session.Store {
  get(sid, callback) {
    respond(
      query('SELECT data FROM hub_sessions WHERE sid = ? AND expires > ?', [sid, Date.now()]).then((rows) =>
        rows[0] ? JSON.parse(rows[0].data) : null
      ),
      callback
    );
  }

  set(sid, sess, callback) {
    const data = JSON.stringify(sess);
    const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DEFAULT_TTL_MS;
    respond(
      query('INSERT INTO hub_sessions (sid, data, expires) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = ?, expires = ?', [
        sid,
        data,
        expires,
        data,
        expires,
      ]).then(() => undefined),
      callback
    );
  }

  destroy(sid, callback) {
    respond(query('DELETE FROM hub_sessions WHERE sid = ?', [sid]).then(() => undefined), callback);
  }
}

module.exports = { init, MysqlSessionStore };
