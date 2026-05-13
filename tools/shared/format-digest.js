/** Génère le champ digest_markdown pour contexte_batiment */
export function formatDigest({ adresse_input, ban, cadastre, georisques, plu, errors }) {
  const lines = [`## Contexte bâtiment — ${adresse_input}`, ''];

  // BAN
  lines.push(`**Adresse normalisée** : ${ban.label_normalise}`);
  lines.push(`**Commune** : ${ban.commune} (${ban.code_postal}) — INSEE ${ban.code_insee}`);
  lines.push(`**Coordonnées** : ${ban.lat}, ${ban.lon} (score BAN : ${ban.score})`);
  lines.push('');

  // Cadastre
  if (cadastre?.parcelles?.length) {
    const p = cadastre.parcelles[0];
    lines.push(`**Parcelle cadastrale** : ${p.id} — section ${p.section} n°${p.numero} — ${p.contenance_m2 ?? '?'} m²`);
  } else {
    lines.push('**Parcelle cadastrale** : non trouvée');
  }
  lines.push('');

  // Géorisques
  if (georisques) {
    const alerts = [];
    if (georisques.pprn?.length) alerts.push(`PPRN : ${georisques.pprn.length} plan(s)`);
    if (georisques.pprt?.length) alerts.push(`PPRT : ${georisques.pprt.length} plan(s)`);
    const catnatCount = georisques.catnat?.length ?? 0;
    if (catnatCount) alerts.push(`CatNat : ${catnatCount} arrêté(s) depuis 1982`);
    if (georisques.radon) alerts.push(`Radon : ${georisques.radon}`);
    if (georisques.sismicite) alerts.push(`Sismicité : ${georisques.sismicite}`);
    if (georisques.icpe_proximite != null) alerts.push(`ICPE à proximité : ${georisques.icpe_proximite}`);
    lines.push(`**Géorisques** : ${alerts.length ? alerts.join(' | ') : 'aucun risque identifié'}`);
  } else {
    lines.push('**Géorisques** : données non disponibles');
  }
  lines.push('');

  // PLU
  if (plu?.zone) {
    lines.push(`**Zone PLU** : ${plu.zone}${plu.libelle_zone ? ` — ${plu.libelle_zone}` : ''}`);
    if (plu.lien_reglement) lines.push(`[→ Règlement PLU](${plu.lien_reglement})`);
  } else {
    lines.push('**Zone PLU** : non trouvée');
  }

  // Erreurs
  if (errors?.length) {
    lines.push('');
    lines.push(`> ⚠ Sources en erreur : ${errors.map((e) => `${e.source} (${e.reason})`).join(', ')}`);
  }

  return lines.join('\n');
}
