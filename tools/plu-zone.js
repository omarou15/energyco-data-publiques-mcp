import { geocodeBAN } from './shared/ban-client.js';
import { fetchWithTimeout } from './shared/fetch-with-timeout.js';

const GPU_BASE = 'https://apicarto.ign.fr/api/gpu';

async function safeGpuJson(url, label) {
  try {
    const res = await fetchWithTimeout(url);
    // 404 = endpoint retiré ou donnée absente → silence, pas une erreur fatale
    if (res.status === 404) return { ok: false, label, missing: true };
    if (!res.ok) return { ok: false, label, reason: `HTTP ${res.status}` };
    const json = await res.json();
    return { ok: true, label, features: json.features ?? [] };
  } catch (err) {
    return { ok: false, label, reason: err.message.startsWith('TIMEOUT') ? 'TIMEOUT' : err.message };
  }
}

export async function pluZoneHandler({ adresse }) {
  const t0 = Date.now();

  let ban;
  try {
    ban = await geocodeBAN(adresse);
  } catch (err) {
    return JSON.stringify({ source: 'GPU / Géoportail Urbanisme', adresse_input: adresse, error: err.message });
  }

  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [ban.lon, ban.lat] }));

  const [zoneRes, prescRes] = await Promise.all([
    safeGpuJson(`${GPU_BASE}/zone-urba?geom=${geom}`, 'gpu/zone-urba'),
    safeGpuJson(`${GPU_BASE}/prescription-surf?geom=${geom}`, 'gpu/prescription-surf'),
  ]);

  const errors = [];
  if (!zoneRes.ok && !zoneRes.missing) errors.push({ source: zoneRes.label, reason: zoneRes.reason });
  if (!prescRes.ok && !prescRes.missing) errors.push({ source: prescRes.label, reason: prescRes.reason });

  const zoneFeature = zoneRes.ok ? zoneRes.features[0]?.properties ?? null : null;
  const prescriptions = prescRes.ok
    ? prescRes.features.slice(0, 10).map((f) => ({ libelle: f.properties?.libelle, type: f.properties?.typepsc }))
    : [];

  // Lognes et de nombreuses communes n'ont pas versé leur PLU dans le Géoportail Urbanisme
  const pluAbsent = zoneRes.ok && zoneRes.features.length === 0;

  const result = {
    source: 'GPU / Géoportail Urbanisme',
    adresse_input: adresse,
    ban: { label: ban.label, lat: ban.lat, lon: ban.lon, score: ban.score },
    zone: zoneFeature
      ? {
          type_zone: zoneFeature.typezone ?? zoneFeature.libelle,
          libelle_zone: zoneFeature.libelong ?? zoneFeature.lib_type_zone,
          partition: zoneFeature.partition,
          lien_reglement: zoneFeature.urlfic ?? null,
        }
      : null,
    message: pluAbsent
      ? `PLU non versé au Géoportail Urbanisme pour la commune de ${ban.commune} — consulter directement la mairie ou l'EPCI compétent`
      : null,
    prescriptions,
    errors: errors.length ? errors : undefined,
  };

  console.log(JSON.stringify({
    tool: 'plu_zone',
    duration_ms: Date.now() - t0,
    ok: !!zoneFeature,
    plu_absent: pluAbsent,
    errors_count: errors.length,
  }));

  return JSON.stringify(result);
}
