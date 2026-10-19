const fs = require('fs');
const path = require('path');

const LOCAL = path.join(__dirname, 'data', 'demo-data.json');
const REMOTE = process.env.DEMO_SHEETS_JSON_URL || '';
const TTL = 5 * 60 * 1000;
const TABLES = ['production', '5s_audit', 'qcp_audit', 'kaizen', 'breakdown', 'plan_variance'];

let cache = null;
let cacheAt = 0;

function normalize(json) {
  const out = { meta: json.meta || {} };
  for (const key of TABLES) {
    out[key] = Array.isArray(json[key]) ? json[key] : [];
  }
  return out;
}

async function loadData(force = false) {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;

  if (REMOTE) {
    try {
      const response = await fetch(REMOTE, { redirect: 'follow' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const json = await response.json();
      cache = normalize(json);
      cache.source = 'google-sheets';
      cacheAt = Date.now();
      console.log('[data] loaded from Google Sheets');
      return cache;
    } catch (err) {
      console.error('[data] Google Sheets load failed, using local demo:', err.message);
    }
  }

  const json = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
  cache = normalize(json);
  cache.source = 'local-demo';
  cacheAt = Date.now();
  return cache;
}

module.exports = { loadData };
