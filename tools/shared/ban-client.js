import { fetchWithTimeout } from './fetch-with-timeout.js';

const BAN_URL = 'https://api-adresse.data.gouv.fr/search/';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const CACHE_MAX = 1000;

// Simple LRU via insertion-order Map
const cache = new Map();

function cacheKey(adresse) {
  return adresse.toLowerCase().trim();
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU position
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    // Evict oldest
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, ts: Date.now() });
}

/**
 * Géocode une adresse via la BAN.
 * Retourne null si score < 0.3 ou pas de résultat.
 * Lance une erreur "ADRESSE_NON_GEOCODEE" si non géocodable.
 */
export async function geocodeBAN(adresse) {
  const key = cacheKey(adresse);
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = new URL(BAN_URL);
  url.searchParams.set('q', adresse);
  url.searchParams.set('limit', '1');

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`BAN HTTP ${res.status}`);

  const json = await res.json();
  const feature = json.features?.[0];

  if (!feature || feature.properties.score < 0.3) {
    const err = new Error('ADRESSE_NON_GEOCODEE');
    err.code = 'ADRESSE_NON_GEOCODEE';
    err.ban_score = feature?.properties?.score ?? 0;
    throw err;
  }

  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;

  const result = {
    label: p.label,
    score: p.score,
    lat,
    lon,
    code_insee: p.citycode,
    code_postal: p.postcode,
    commune: p.city,
    type: p.type,
    context: p.context,
  };

  cacheSet(key, result);
  return result;
}
