import { fetchWithTimeout } from './shared/fetch-with-timeout.js';

const SIRENE_URL = 'https://recherche-entreprises.api.gouv.fr/search';

function formatResult(r) {
  return {
    siren: r.siren,
    siret_siege: r.siege?.siret,
    denomination: r.nom_complet ?? r.denomination,
    code_naf: r.activite_principale,
    libelle_naf: r.libelle_activite_principale_entreprise,
    adresse: r.siege
      ? [r.siege.adresse, r.siege.code_postal, r.siege.commune].filter(Boolean).join(' ')
      : null,
    code_postal_siege: r.siege?.code_postal ?? null,
    etat: r.etat_administratif === 'A' ? 'actif' : r.etat_administratif === 'C' ? 'cessé' : r.etat_administratif,
    date_creation: r.date_creation,
    dirigeants: (r.dirigeants ?? []).slice(0, 3).map((d) => ({
      nom: [d.prenom, d.nom].filter(Boolean).join(' ') || d.denomination,
      qualite: d.qualite,
    })),
  };
}

export async function sireneEntrepriseHandler({ query, code_postal }) {
  const t0 = Date.now();

  const url = new URL(SIRENE_URL);
  url.searchParams.set('q', query);

  // L'API ne supporte pas code_postal comme filtre direct.
  // On filtre via departement (2 premiers chiffres) et on post-filtre en JS.
  const departement = code_postal ? code_postal.slice(0, 2) : null;
  if (departement) {
    url.searchParams.set('departement', departement);
    url.searchParams.set('per_page', '25');
  } else {
    url.searchParams.set('per_page', '10');
  }

  try {
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    let raw = json.results ?? [];

    // Post-filtre sur code_postal exact si fourni
    const filtered = code_postal
      ? raw.filter((r) => r.siege?.code_postal === code_postal)
      : raw;

    const results = filtered.map(formatResult);

    console.log(JSON.stringify({
      tool: 'sirene_entreprise',
      duration_ms: Date.now() - t0,
      ok: true,
      total_api: json.total_results,
      count_filtered: results.length,
      departement_used: departement,
    }));

    return JSON.stringify({
      source: 'Sirene / INSEE',
      query,
      code_postal: code_postal ?? null,
      total_national: json.total_results ?? raw.length,
      count: results.length,
      filtre_applique: code_postal ? `departement ${departement} + code_postal ${code_postal}` : null,
      results,
    });
  } catch (err) {
    console.log(JSON.stringify({ tool: 'sirene_entreprise', duration_ms: Date.now() - t0, ok: false, error: err.message }));
    return JSON.stringify({ source: 'Sirene / INSEE', query, error: err.message });
  }
}
