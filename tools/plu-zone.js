import { geocodeBAN } from './shared/ban-client.js';
import { fetchWithTimeout } from './shared/fetch-with-timeout.js';

const GPU_BASE = 'https://apicarto.ign.fr/api/gpu';

export async function pluZoneHandler({ adresse }) {
  const t0 = Date.now();

  let ban;
  try {
    ban = await geocodeBAN(adresse);
  } catch (err) {
    return JSON.stringify({ source: 'GPU / Géoportail Urbanisme', adresse_input: adresse, error: err.message });
  }

  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [ban.lon, ban.lat] }));

  const [zoneRes, prescRes, servRes] = await Promise.allSettled([
    fetchWithTimeout(`${GPU_BASE}/zone-urba?geom=${geom}`),
    fetchWithTimeout(`${GPU_BASE}/prescription-surf?geom=${geom}`),
    fetchWithTimeout(`${GPU_BASE}/servitude-surf?geom=${geom}`),
  ]);

  const errors = [];

  async function parseFeatures(settled, label) {
    if (settled.status === 'rejected') {
      errors.push({ source: label, reason: settled.reason?.message ?? 'ERREUR' });
      return [];
    }
    const res = settled.value;
    if (!res.ok) {
      errors.push({ source: label, reason: `HTTP ${res.status}` });
      return [];
    }
    try {
      const json = await res.json();
      return json.features ?? [];
    } catch {
      errors.push({ source: label, reason: 'PARSE_ERROR' });
      return [];
    }
  }

  const [zones, prescriptions, servitudes] = await Promise.all([
    parseFeatures(zoneRes, 'gpu/zone-urba'),
    parseFeatures(prescRes, 'gpu/prescription-surf'),
    parseFeatures(servRes, 'gpu/servitude-surf'),
  ]);

  const zone = zones[0]?.properties ?? null;

  const result = {
    source: 'GPU / Géoportail Urbanisme',
    adresse_input: adresse,
    ban: { label: ban.label, lat: ban.lat, lon: ban.lon, score: ban.score },
    zone: zone
      ? {
          type_zone: zone.typezone ?? zone.libelle,
          libelle_zone: zone.libelong ?? zone.lib_type_zone,
          partition: zone.partition,
          lien_reglement: zone.urlfic ?? null,
        }
      : null,
    prescriptions: prescriptions.slice(0, 10).map((f) => ({
      libelle: f.properties?.libelle,
      type: f.properties?.typepsc,
    })),
    servitudes: servitudes.slice(0, 10).map((f) => ({
      libelle: f.properties?.libelle,
      type: f.properties?.typesas ?? f.properties?.type,
    })),
    errors: errors.length ? errors : undefined,
  };

  console.log(JSON.stringify({
    tool: 'plu_zone',
    duration_ms: Date.now() - t0,
    ok: !!zone,
    errors_count: errors.length,
  }));

  return JSON.stringify(result);
}
