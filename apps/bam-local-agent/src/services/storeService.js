import pool from '../config/db.js';

const STATES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware',
  FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky',
  LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri',
  MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
  NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island',
  SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia',
  WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming', DC: 'district of columbia'
};

const COLS = 'location_id, name, address, city, state, zip';
let cache = null;   // stores change rarely; cleared on create

export async function listStores() {
  if (!cache) { const [rows] = await pool.execute(`SELECT ${COLS} FROM stores ORDER BY id`); cache = rows; }
  return cache;
}
export async function storeExists(locationId) {
  return typeof locationId === 'string' && (await listStores()).some((s) => s.location_id === locationId);
}

export const slugify = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const fail = (status, message) => Object.assign(new Error(message), { status });

/**
 * Every field is required: the AI builds its picture of the local community (demographics, schools, events, culture)
 * from exactly these details, so a missing or vague one means a worse result. Throws an Error with .status when invalid.
 */
function validateStoreInput(input = {}) {
  const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  const name = clean(input.name, 150);
  const address = clean(input.address, 255);
  const city = clean(input.city, 100);
  const state = clean(input.state, 2).toUpperCase();
  const zip = clean(input.zip, 10);
  if (name.length < 3) throw fail(400, 'Enter the store name.');
  if (address.length < 5 || !/\d/.test(address)) throw fail(400, 'Enter the full street address, including the number.');
  if (city.length < 2) throw fail(400, 'Enter the store city.');
  if (!STATES[state]) throw fail(400, 'Enter a valid two-letter US state, like GA.');
  if (!/^\d{5}(-\d{4})?$/.test(zip)) throw fail(400, 'Enter the ZIP code, like 30080.');
  if (!slugify(city)) throw fail(400, 'City must contain letters or numbers.');
  return { name, address, city, state, zip };
}

/** Two stores may share a city, but not the same name in the same city. */
async function assertNotDuplicate({ name, city, state }, exceptLocationId = null) {
  const [dup] = await pool.execute(
    'SELECT 1 FROM stores WHERE LOWER(name) = LOWER(?) AND LOWER(city) = LOWER(?) AND state = ? AND location_id <> ? LIMIT 1',
    [name, city, state, exceptLocationId ?? '']
  );
  if (dup.length) throw fail(409, `${name} already exists in ${city}, ${state}.`);
}

/** location_id is "city-st"; a second store in the same city gets "city-st-store-name" (then -2, -3...). The id never changes later. */
async function freeLocationId({ name, city, state }) {
  const base = `${slugify(city)}-${state.toLowerCase()}`.slice(0, 50);
  const candidates = [base, `${base}-${slugify(name)}`.slice(0, 50)];
  for (let i = 2; i < 50; i++) candidates.push(`${candidates[1].slice(0, 46)}-${i}`);
  for (const id of candidates) {
    const [taken] = await pool.execute('SELECT 1 FROM stores WHERE location_id = ? LIMIT 1', [id]);
    if (!taken.length) return id;
  }
  throw fail(409, 'Could not create a unique id for this store.');
}

/** Validates and inserts a store. Throws an Error with .status for bad input / duplicates. */
export async function createStore(input = {}) {
  const v = validateStoreInput(input);
  await assertNotDuplicate(v);
  const locationId = await freeLocationId(v);
  await pool.execute('INSERT INTO stores (location_id, name, address, city, state, zip) VALUES (?, ?, ?, ?, ?, ?)', [locationId, v.name, v.address, v.city, v.state, v.zip]);
  cache = null;
  return { location_id: locationId, ...v, research_status: 'none' };
}

/** Changes a store's details (same rules as adding one). Its location_id stays the same so its knowledge stays attached. */
export async function updateStore(locationId, input = {}) {
  const [rows] = await pool.execute('SELECT location_id FROM stores WHERE location_id = ?', [locationId]);
  if (!rows.length) throw fail(404, 'Store not found.');
  const v = validateStoreInput(input);
  await assertNotDuplicate(v, locationId);
  await pool.execute('UPDATE stores SET name = ?, address = ?, city = ?, state = ?, zip = ? WHERE location_id = ?', [v.name, v.address, v.city, v.state, v.zip, locationId]);
  cache = null;
  return { location_id: locationId, ...v };
}

/** Removes a store and all of its local knowledge. Playbook chunks (location_id NULL) are untouched. Returns false if it does not exist. */
export async function deleteStore(locationId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM knowledge_chunks WHERE location_id = ?', [locationId]);
    const [result] = await conn.execute('DELETE FROM stores WHERE location_id = ?', [locationId]);
    await conn.commit();
    cache = null;
    return result.affectedRows > 0;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally { conn.release(); }
}
