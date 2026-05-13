import { geocodeBAN } from './shared/ban-client.js';
import { fetchWithTimeout } from './shared/fetch-with-timeout.js';

const GEORISQUES = 'https://georisques.gouv.fr/api/v1';

async function safeGet(url, label) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, label, status: res.status };
    const json = await res.json();
    return { ok: true, label, data: json };
  } catch (err) {
    return { ok: false, label, reason: err.message.startsWith('TIMEOUT') ? 'TIMEOUT' : err.message };
  }
}

// Paris (75101-75120) → 75056, Lyon (69381-69389) → 69123, Marseille (13201-13216) → 13055
// BAN geocodes arrondissements with their own INSEE, but Georisques only has data at commune level.
function communeInsee(inseeFromBan) {
  const s = String(inseeFromBan);
  if (/^751[01]\d$/.test(s)) return '75056'; // Paris 1e-20e
  if (/^6938[1-9]$/.test(s)) return '69123'; // Lyon 1er-9e
  if (/^132[01]\d$/.test(s)) return '13055'; // Marseille 1er-16e
  return s;
}

export async function georisquesCommuneHandler({ adresse }) {
  const t0 = Date.now();

  let ban;
  try {
    ban = await geocodeBAN(adresse);
  } catch (err) {
    return JSON.stringify({ source: 'Géorisques', adresse_input: adresse, error: err.message });
  }

  const inseeRaw = ban.code_insee;
  const insee = communeInsee(inseeRaw);

  const calls = await Promise.allSettled([
    safeGet(`${GEORISQUES}/gaspar/risques?code_insee=${insee}`, 'ppr'),
    safeGet(`${GEORISQUES}/gaspar/catnat?code_insee=${insee}`, 'catnat'),
    safeGet(`${GEORISQUES}/radon?code_insee=${insee}`, 'radon'),
    safeGet(`${GEORISQUES}/zonage_sismique?code_insee=${insee}`, 'sismicite'),
    safeGet(`${GEORISQUES}/installations_classees?code_insee=${insee}`, 'icpe'),
  ]);

  const [pprRes, catnatRes, radonRes, seismoRes, icpeRes] = calls.map((r) =>
    r.status === 'fulfilled' ? r.value : { ok: false, reason: r.reason?.message ?? 'ERREUR' }
  );

  const errors = [];
  const addErr = (res, source) => {
    if (!res.ok) errors.push({ source, reason: res.reason ?? `HTTP ${res.status}` });
  };
  addErr(pprRes, 'georisques/ppr');
  addErr(catnatRes, 'georisques/catnat');
  addErr(radonRes, 'georisques/radon');
  addErr(seismoRes, 'georisques/sismicite');
  addErr(icpeRes, 'georisques/icpe');

  const pprItems = pprRes.ok ? (pprRes.data?.data ?? pprRes.data?.results ?? []) : [];
  const pprn = pprItems.filter((r) => (r.type_risque ?? r.libelle ?? '').toUpperCase().includes('N'));
  const pprt = pprItems.filter((r) => (r.type_risque ?? r.libelle ?? '').toUpperCase().includes('T'));

  const catnat = catnatRes.ok
    ? (catnatRes.data?.data ?? catnatRes.data?.results ?? []).map((r) => ({
        libelle: r.libelle_risque_jo ?? r.libelle,
        date_debut: r.date_debut_evt ?? r.date_debut,
        date_arrete: r.dat_pub_arrete ?? r.date_arrete,
      }))
    : null;

  const radonData = radonRes.ok ? (radonRes.data?.data?.[0] ?? radonRes.data?.results?.[0]) : null;
  const radon = radonData ? `Catégorie ${radonData.classe_potentiel ?? radonData.potentiel_radon ?? '?'}` : null;

  const seismoData = seismoRes.ok ? (seismoRes.data?.data?.[0] ?? seismoRes.data?.results?.[0]) : null;
  const sismicite = seismoData ? seismoData.zone_sismicite ?? `Zone ${seismoData.code_zone}` : null;

  const icpeItems = icpeRes.ok ? (icpeRes.data?.data ?? icpeRes.data?.results ?? []) : [];

  const result = {
    source: 'Géorisques',
    adresse_input: adresse,
    commune: ban.commune,
    code_insee: insee,
    code_insee_ban: inseeRaw !== insee ? inseeRaw : undefined,
    pprn: pprn.map((r) => ({ libelle: r.libelle, etat: r.etat, date: r.date_approbation })),
    pprt: pprt.map((r) => ({ libelle: r.libelle, etat: r.etat, date: r.date_approbation })),
    catnat,
    radon,
    sismicite,
    icpe_proximite: icpeItems.length,
    icpe_liste: icpeItems.slice(0, 5).map((i) => ({ nom: i.raisonSociale ?? i.nom, statut: i.etatActivite ?? i.etat_activite })),
    errors: errors.length ? errors : undefined,
  };

  console.log(JSON.stringify({
    tool: 'georisques_commune',
    duration_ms: Date.now() - t0,
    code_insee: insee,
    code_insee_raw: inseeRaw,
    errors_count: errors.length,
  }));

  return JSON.stringify(result);
}
