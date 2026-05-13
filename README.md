# energyco-data-publiques MCP Server

Serveur MCP HTTP stateless exposant 6 outils d'accès aux données publiques françaises pour l'audit énergétique et immobilier.

## Outils exposés

| Outil | Source | Description |
|-------|--------|-------------|
| `contexte_batiment` | Agrégé | TOUT le contexte d'un bâtiment en 1 appel |
| `georisques_commune` | Géorisques/BRGM | PPRN, PPRT, CatNat, radon, sismicité, argiles |
| `cadastre_parcelle` | IGN Apicarto/DGFiP | Parcelle(s) cadastrale(s), surface |
| `sirene_entreprise` | Sirene/INSEE | Recherche entreprise par nom ou SIREN/SIRET |
| `plu_zone` | IGN GPU | Zonage PLU/PLUi, servitudes, prescriptions |
| `ban_geocode` | BAN data.gouv.fr | Géocodage adresse → GPS + INSEE |

## Déploiement Railway

Variables d'environnement requises :
- `MCP_TOKEN` : token secret pour authentifier les requêtes MCP

## Connexion claude.ai

```
URL : https://<votre-service>.up.railway.app/mcp?token=<MCP_TOKEN>
Nom : Energyco Data Publiques
```

## Test local

```bash
npm install
MCP_TOKEN=test node server.js &

# Health check
curl http://localhost:3000/health

# tools/list
curl -X POST http://localhost:3000/mcp?token=test \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Test ban_geocode
curl -X POST http://localhost:3000/mcp?token=test \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ban_geocode","arguments":{"adresse":"38 bd du Segrais 77185 Lognes"}}}'
```
