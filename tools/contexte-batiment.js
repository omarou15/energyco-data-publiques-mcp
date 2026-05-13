import { geocodeBAN } from './shared/ban-client.js';
import { fetchWithTimeout } from './shared/fetch-with-timeout.js';
import { formatDigest } from './shared/format-digest.js';

const GEORISQUES = 'https://georisques.gouv.fr/api/v1';
const GPU_BASE = 'https://apicarto.ign.fr/api/gpu';
const CADASTRE_URL = 'https://apicarto.ign.fr/api/cadastre/parcelle';

async function safeJson(url, label) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, label, status: res.status };
    return { ok: true, label, data: await res.json() };
  } catch (err) {
    return { ok: false, label, reason: err.message.startsWith('TIMEOUT') ? 'TIMEOUT' : err.message };
  }
}

async function fetchGeorisques(ban) {
  const insee = ban.code_insee;
  const latlon = `${ban.lon},${ban.lat}`;

  const settled = await Promise.allSettled([
    safeJson(`${GEORISQUES}/gaspar/risques?code_insee=${insee}`, 'ppr'),
    safeJson(`${GEORISQUES}/gaspar/catnat?code_insee=${insee}`, 'catnat'),
    safeJson(`${GEORISQUES}/radon?code_insee=${insee}`, 'radon'),
    safeJson(`${GEORISQUES}/zonage_sismique?code_insee=${insee}`, 'sismicite'),
    safeJson(`${GEORISQUES}/installations_classees?code_insee=${insee}`, 'icpe'),
  ]);

  const errors = [];
  const resolved = settled.map((r) =>
    r.status === 'fulfilled' ? r.value : { ok: false, reason: 'ERREUR' }
  );
  const [ppr, catnat, radon, seismo, icpe] = resolved;

  resolved.forEach((r, i) => {
    if (!r.ok) errors.push({ source: ['ppr', 'catnat', 'radon', 'sismicite', 'icpe'][i], reason: r.reason ?? `HTTP ${r.status}` });
  });

  const pprItems = ppr.ok ? (ppr.data?.data ?? ppr.data?.results ?? []) : [];
  const catnatItems = catnat.ok ? (catnat.data?.data ?? catnat.data?.results ?? []) : [];
  const radonData = radon.ok ? (radon.data?.data?.[0] ?? radon.data?.results?.[0]) : null;
  const seismoData = seismo.ok ? (seismo.data?.data?.[0] ?? seismo.data?.results?.[0]) : null;
  const icpeItems = icpe.ok ? (icpe.data?.data ?? icpe.data?.results ?? []) : [];
  const catnatAll = catnatItems.map((r) => ({ libelle: r.libelle_risque_jo ?? r.libelle, date_debut: r.date_debut_evt ?? r.date_debut }));

  return {
    pprn: pprItems.filter((r) => (r.type_risque ?? r.libelle ?? '').toUpperCase().includes('N')).map((r) => ({ libelle: r.libelle, etat: r.etat })),
    pprt: pprItems.filter((r) => (r.type_risque ?? r.libelle ?? '').toUpperCase().includes('T')).map((r) => ({ libelle: r.libelle, etat: r.etat })),
    catnat: catnatAll,
    catnat_recents: catnatAll.slice(0, 5),
    radon: radonData ? `Catégorie ${radonData.classe_potentiel ?? radonData.potentiel_radon ?? '?'}` : null,
    sismicite: seismoData ? seismoData.zone_sismicite ?? `Zone ${seismoData.code_zone}` : null,
    icpe_proximite: icpeItems.length,
    icpe_liste: icpeItems.slice(0, 5).map((i) => ({ nom: i.raisonSociale ?? i.nom, statut: i.etatActivite ?? i.etat_activite })),
    errors,
  };
}

async function fetchCadastre(ban) {
  const geom = JSON.stringify({ type: 'Point', coordinates: [ban.lon, ban.lat] });
  const url = `${CADASTRE_URL}?geom=${encodeURIComponent(geom)}&source_ign=PCI`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const parcelles = (json.features ?? []).map((f) => {
      const p = f.properties ?? {};
      return {
        id: p.id ?? `${p.code_dep ?? ''}${p.code_com ?? ''}${p.section ?? ''}${p.numero ?? ''}`,
        section: p.section,
        numero: p.numero,
        contenance_m2: p.contenance,
      };
    });
    return { ok: true, parcelles };
  } catch (err) {
    return { ok: false, reason: err.message.startsWith('TIMEOUT') ? 'TIMEOUT' : err.message };
  }
}

async function fetchPLU(ban) {
  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [ban.lon, ban.lat] }));
  try {
    const res = await fetchWithTimeout(`${GPU_BASE}/zone-urba?geom=${geom}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const zone = json.features?.[0]?.properties ?? null;
    return {
      ok: true,
      zone: zone ? zone.typezone ?? zone.libelle : null,
      libelle_zone: zone ? zone.libelong ?? zone.lib_type_zone : null,
      lien_reglement: zone?.urlfic ?? null,
    };
  } catch (err) {
    return { ok: false, reason: err.message.startsWith('TIMEOUT') ? 'TIMEOUT' : err.message };
  }
}

export async function contexteBatimentHandler({ adresse }) {
  const t0 = Date.now();

  let ban;
  try {
    ban = await geocodeBAN(adresse);
  } catch (err) {
    return JSON.stringify({ source: 'Energyco Data Publiques', adresse_input: adresse, error: err.message });
  }

  // Appels parallèles
  const [georisquesRes, cadastreRes, pluRes] = await Promise.allSettled([
    fetchGeorisques(ban),
    fetchCadastre(ban),
    fetchPLU(ban),
  ]);

  const errors = [];

  const georisques = georisquesRes.status === 'fulfilled' ? georisquesRes.value : null;
  if (georisquesRes.status === 'rejected') errors.push({ source: 'georisques', reason: 'ERREUR' });
  if (georisques?.errors?.length) errors.push(...georisques.errors);

  const cadastreData = cadastreRes.status === 'fulfilled' ? cadastreRes.value : { ok: false, reason: 'ERREUR' };
  if (!cadastreData.ok) errors.push({ source: 'cadastre', reason: cadastreData.reason ?? 'ERREUR' });

  const pluData = pluRes.status === 'fulfilled' ? pluRes.value : { ok: false, reason: 'ERREUR' };
  // ok:false = erreur réseau/API ; ok:true avec zone:null = PLU absent du GPU (pas une erreur)
  if (!pluData.ok) errors.push({ source: 'plu', reason: pluData.reason ?? 'ERREUR' });

  const banOut = {
    label_normalise: ban.label,
    code_insee: ban.code_insee,
    code_postal: ban.code_postal,
    commune: ban.commune,
    lat: ban.lat,
    lon: ban.lon,
    score: ban.score,
    type: ban.type,
  };

  const cadastreOut = {
    parcelles: cadastreData.ok ? cadastreData.parcelles : [],
  };

  const pluOut = {
    zone: pluData.ok ? pluData.zone : null,
    libelle_zone: pluData.ok ? pluData.libelle_zone : null,
    lien_reglement: pluData.ok ? pluData.lien_reglement : null,
    message: pluData.ok && !pluData.zone
      ? `PLU non versé au Géoportail Urbanisme pour ${ban.commune} — consulter la mairie ou l'EPCI`
      : null,
  };

  const digestData = { adresse_input: adresse, ban: banOut, cadastre: cadastreOut, georisques, plu: pluOut, errors };

  const result = {
    source: 'Energyco Data Publiques',
    adresse_input: adresse,
    ban: banOut,
    cadastre: cadastreOut,
    georisques: georisques
      ? {
          pprn: georisques.pprn,
          pprt: georisques.pprt,
          catnat_recents: georisques.catnat_recents,
          catnat_total: georisques.catnat?.length ?? 0,
          radon: georisques.radon,
          sismicite: georisques.sismicite,
          icpe_proximite: georisques.icpe_proximite,
          icpe_liste: georisques.icpe_liste,
        }
      : null,
    plu: pluOut,
    sirene_proprietaire: null,
    errors: errors.length ? errors : undefined,
    digest_markdown: formatDigest(digestData),
  };

  console.log(JSON.stringify({
    tool: 'contexte_batiment',
    duration_ms: Date.now() - t0,
    code_insee: ban.code_insee,
    errors_count: errors.length,
  }));

  return JSON.stringify(result);
}
