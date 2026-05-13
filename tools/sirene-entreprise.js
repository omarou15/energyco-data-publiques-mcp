import { fetchWithTimeout } from './shared/fetch-with-timeout.js';

const SIRENE_URL = 'https://recherche-entreprises.api.gouv.fr/search';

// code_postal API param is unreliable — departement is stable and supported
function deptFromCP(cp) {
  const s = String(cp ?? '').replace(/\s/g, '');
  if (!s) return null;
  if (s.startsWith('97')) return s.slice(0, 3); // DOM-TOM: 971-976
  if (s >= '20000' && s <= '20190') return '2A'; // Corse-du-Sud
  if (s >= '20200' && s < '21000') return '2B'; // Haute-Corse
  return s.slice(0, 2);
}

export async function sireneEntrepriseHandler({ query, code_postal }) {
  const t0 = Date.now();

  const url = new URL(SIRENE_URL);
  url.searchParams.set('q', query);
  const dept = deptFromCP(code_postal);
  if (dept) url.searchParams.set('departement', dept);
  url.searchParams.set('per_page', '5');

  try {
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const results = (json.results ?? []).map((r) => ({
      siren: r.siren,
      siret_siege: r.siege?.siret,
      denomination: r.nom_complet ?? r.denomination,
      code_naf: r.activite_principale,
      libelle_naf: r.libelle_activite_principale_entreprise,
      adresse: r.siege
        ? [r.siege.adresse, r.siege.code_postal, r.siege.commune].filter(Boolean).join(' ')
        : null,
      etat: r.etat_administratif === 'A' ? 'actif' : r.etat_administratif === 'C' ? 'cessé' : r.etat_administratif,
      date_creation: r.date_creation,
      dirigeants: (r.dirigeants ?? []).slice(0, 3).map((d) => ({
        nom: [d.prenom, d.nom].filter(Boolean).join(' ') || d.denomination,
        qualite: d.qualite,
      })),
    }));

    console.log(JSON.stringify({ tool: 'sirene_entreprise', duration_ms: Date.now() - t0, ok: true, count: results.length }));

    return JSON.stringify({
      source: 'Sirene / INSEE',
      query,
      code_postal: code_postal ?? null,
      departement_filtre: dept ?? null,
      total: json.total_results ?? results.length,
      results,
    });
  } catch (err) {
    console.log(JSON.stringify({ tool: 'sirene_entreprise', duration_ms: Date.now() - t0, ok: false, error: err.message }));
    return JSON.stringify({ source: 'Sirene / INSEE', query, error: err.message });
  }
}
