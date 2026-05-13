// Test des 4 bugs sur les 3 adresses de référence
// Usage : node test-local.js
import { sireneEntrepriseHandler } from './tools/sirene-entreprise.js';
import { georisquesCommuneHandler } from './tools/georisques-commune.js';
import { pluZoneHandler } from './tools/plu-zone.js';

const ADRESSES = {
  lognes:  '38 bd du Segrais 77185 Lognes',
  paris:   '35 rue de la Paix 75002 Paris',
  lyon:    '15 cours Lafayette 69003 Lyon',
};

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` → ${detail}` : ''}`);
    failed++;
  }
}

async function testSirene() {
  console.log('\n══ BUG 1 — sirene_entreprise filtre département ══');

  // ENGIE, CP=92100 → département 92 → doit trouver ENGIE (siège 92250, même département)
  const r1 = JSON.parse(await sireneEntrepriseHandler({ query: 'ENGIE', code_postal: '92100' }));
  console.log(`\n  ENGIE dept=92: total=${r1.total} filtre=${r1.departement_filtre}`);
  check('ENGIE dept=92 : filtre département appliqué', r1.departement_filtre === '92', `filtre=${r1.departement_filtre}`);
  check('ENGIE dept=92 : résultats > 0', r1.total > 0, `total=${r1.total}`);
  check('ENGIE dept=92 : premier résultat contient ENGIE', /engie/i.test(r1.results?.[0]?.denomination ?? ''), r1.results?.[0]?.denomination);

  // CARREFOUR, CP=91300 → département 91 → doit trouver Carrefour Massy
  const r2 = JSON.parse(await sireneEntrepriseHandler({ query: 'CARREFOUR', code_postal: '91300' }));
  console.log(`\n  CARREFOUR dept=91: total=${r2.total} filtre=${r2.departement_filtre}`);
  check('CARREFOUR dept=91 : filtre département appliqué', r2.departement_filtre === '91', `filtre=${r2.departement_filtre}`);
  check('CARREFOUR dept=91 : résultats > 0', r2.total > 0, `total=${r2.total}`);

  // SCI DU CHENE VERT, CP=77185 → département 77 → doit chercher dans Seine-et-Marne
  const r3 = JSON.parse(await sireneEntrepriseHandler({ query: 'SCI DU CHENE VERT', code_postal: '77185' }));
  console.log(`\n  SCI CHENE VERT dept=77: total=${r3.total} filtre=${r3.departement_filtre}`);
  check('SCI CHENE VERT dept=77 : filtre département appliqué', r3.departement_filtre === '77', `filtre=${r3.departement_filtre}`);
  // Peut retourner 0 si la SCI n'est pas en 77 — ce qui est OK, l'important est que le filtre fonctionne
  check('SCI CHENE VERT dept=77 : pas d\'erreur HTTP', !r3.error, r3.error);

  // Sans code_postal → pas de filtre
  const r4 = JSON.parse(await sireneEntrepriseHandler({ query: 'SCI DU CHENE VERT' }));
  check('SCI CHENE VERT sans CP : total > 0 (national)', r4.total > 0, `total=${r4.total}`);
  check('SCI CHENE VERT sans CP : pas de filtre dept', r4.departement_filtre === null, `filtre=${r4.departement_filtre}`);
}

async function testGeorisques() {
  console.log('\n══ BUG 2 — georisques_commune arrondissements ══');

  // Lognes — commune simple, doit fonctionner inchangé
  const rLognes = JSON.parse(await georisquesCommuneHandler({ adresse: ADRESSES.lognes }));
  console.log(`\n  Lognes: insee=${rLognes.code_insee} catnat=${rLognes.catnat?.length} sism=${rLognes.sismicite}`);
  check('Lognes : catnat > 0', (rLognes.catnat?.length ?? 0) > 0, `catnat=${rLognes.catnat?.length}`);
  check('Lognes : sismicité non null', !!rLognes.sismicite, rLognes.sismicite);
  check('Lognes : code_insee = 77258', rLognes.code_insee === '77258', rLognes.code_insee);

  // Lyon 3e — arrondissement → doit mapper vers 69123
  const rLyon = JSON.parse(await georisquesCommuneHandler({ adresse: ADRESSES.lyon }));
  console.log(`\n  Lyon 69003: insee=${rLyon.code_insee} insee_ban=${rLyon.code_insee_ban} catnat=${rLyon.catnat?.length} sism=${rLyon.sismicite}`);
  check('Lyon : code_insee mappé vers 69123', rLyon.code_insee === '69123', rLyon.code_insee);
  check('Lyon : catnat > 0', (rLyon.catnat?.length ?? 0) > 0, `catnat=${rLyon.catnat?.length}`);
  check('Lyon : sismicité zone 2', /2/i.test(rLyon.sismicite ?? ''), rLyon.sismicite);

  // Paris 75002 — arrondissement → doit mapper vers 75056
  const rParis = JSON.parse(await georisquesCommuneHandler({ adresse: ADRESSES.paris }));
  console.log(`\n  Paris 75002: insee=${rParis.code_insee} catnat=${rParis.catnat?.length} sism=${rParis.sismicite}`);
  check('Paris : code_insee mappé vers 75056', rParis.code_insee === '75056', rParis.code_insee);
  check('Paris : catnat non null', rParis.catnat !== null, 'catnat=null');
}

async function testPlu() {
  console.log('\n══ BUG 3+4 — plu_zone servitudes + message PLU absent ══');

  // Paris — PLU connu, servitudes via acte-sup ne doivent plus être en erreur 404
  const rParis = JSON.parse(await pluZoneHandler({ adresse: ADRESSES.paris }));
  console.log(`\n  Paris: zone=${rParis.zone?.type_zone} servitudes=${rParis.servitudes?.length} errors=${JSON.stringify(rParis.errors)}`);
  check('Paris : pas d\'erreur gpu/servitude-surf', !(rParis.errors ?? []).some(e => e.source === 'gpu/servitude-surf'), JSON.stringify(rParis.errors));
  check('Paris : zone non null', !!rParis.zone, 'zone=null');
  check('Paris : pas de message PLU absent (zone trouvée)', !rParis.message, rParis.message);

  // Lyon — PLU probablement disponible
  const rLyon = JSON.parse(await pluZoneHandler({ adresse: ADRESSES.lyon }));
  console.log(`\n  Lyon: zone=${rLyon.zone?.type_zone} errors=${JSON.stringify(rLyon.errors)}`);
  check('Lyon : pas d\'erreur gpu/servitude-surf', !(rLyon.errors ?? []).some(e => e.source === 'gpu/servitude-surf'), JSON.stringify(rLyon.errors));

  // Lognes — PLU absent du GPU → message attendu
  const rLognes = JSON.parse(await pluZoneHandler({ adresse: ADRESSES.lognes }));
  console.log(`\n  Lognes: zone=${rLognes.zone} message=${rLognes.message?.slice(0, 60)}`);
  check('Lognes : zone null (absent GPU)', rLognes.zone === null, JSON.stringify(rLognes.zone));
  check('Lognes : message PLU absent présent', typeof rLognes.message === 'string' && rLognes.message.includes('Géoportail Urbanisme'), rLognes.message);
  check('Lognes : pas d\'erreur gpu/servitude-surf', !(rLognes.errors ?? []).some(e => e.source === 'gpu/servitude-surf'), JSON.stringify(rLognes.errors));
}

// Run all tests
try {
  await testSirene();
  await testGeorisques();
  await testPlu();
} catch (err) {
  console.error('\n✗ Exception non gérée :', err.message);
  console.error(err.stack);
  failed++;
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Résultat : ${passed} ✓  ${failed} ✗`);
if (failed > 0) {
  console.error(`\n✗ ${failed} test(s) échoué(s)`);
  process.exit(1);
} else {
  console.log('\n✓ Tous les tests passent');
}
