import { geocodeBAN } from './shared/ban-client.js';
import { fetchWithTimeout } from './shared/fetch-with-timeout.js';

const CADASTRE_URL = 'https://apicarto.ign.fr/api/cadastre/parcelle';

export async function cadastreParcelleHandler({ adresse }) {
  const t0 = Date.now();

  let ban;
  try {
    ban = await geocodeBAN(adresse);
  } catch (err) {
    return JSON.stringify({ source: 'Cadastre IGN', adresse_input: adresse, error: err.message });
  }

  const geom = JSON.stringify({ type: 'Point', coordinates: [ban.lon, ban.lat] });
  const url = `${CADASTRE_URL}?geom=${encodeURIComponent(geom)}&source_ign=PCI`;

  let parcelles = [];
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const features = json.features ?? [];
    parcelles = features.map((f) => {
      const p = f.properties ?? {};
      return {
        id: p.id ?? `${p.code_dep}${p.code_com}${p.section}${p.numero}`,
        section: p.section,
        numero: p.numero,
        contenance_m2: p.contenance,
        code_insee: p.code_insee ?? p.code_dep + p.code_com,
        commune: p.nom_com,
      };
    });
  } catch (err) {
    console.log(JSON.stringify({ tool: 'cadastre_parcelle', duration_ms: Date.now() - t0, ok: false, error: err.message }));
    return JSON.stringify({
      source: 'Cadastre IGN',
      adresse_input: adresse,
      ban: { label: ban.label, lat: ban.lat, lon: ban.lon },
      error: err.message,
    });
  }

  console.log(JSON.stringify({ tool: 'cadastre_parcelle', duration_ms: Date.now() - t0, ok: true, count: parcelles.length }));

  return JSON.stringify({
    source: 'Cadastre IGN',
    adresse_input: adresse,
    ban: { label: ban.label, lat: ban.lat, lon: ban.lon, score: ban.score },
    parcelles,
  });
}
