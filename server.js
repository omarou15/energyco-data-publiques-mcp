import { createServer } from 'http';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { banGeocodeHandler } from './tools/ban-geocode.js';
import { georisquesCommuneHandler } from './tools/georisques-commune.js';
import { cadastreParcelleHandler } from './tools/cadastre-parcelle.js';
import { sireneEntrepriseHandler } from './tools/sirene-entreprise.js';
import { pluZoneHandler } from './tools/plu-zone.js';
import { contexteBatimentHandler } from './tools/contexte-batiment.js';

const PORT = process.env.PORT || 3000;
const MCP_TOKEN = process.env.MCP_TOKEN;

if (!MCP_TOKEN) {
  console.error('ERROR: MCP_TOKEN environment variable is required');
  process.exit(1);
}

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  next();
});

app.options('*', (_req, res) => res.sendStatus(204));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'energyco-data-publiques' }));

function mcpLogger(req, _res, next) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    method: req.method,
    hasTokenQuery: !!req.query.token,
    hasTokenHeader: !!req.headers.authorization,
    hasSessionId: !!req.headers['mcp-session-id'],
    bodyMethod: req.body?.method ?? null,
  }));
  next();
}

function authMiddleware(req, res, next) {
  const tokenFromQuery = req.query.token;
  const tokenFromHeader = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const token = tokenFromQuery || tokenFromHeader;
  if (!token || token !== MCP_TOKEN) {
    const source = tokenFromQuery ? 'query' : tokenFromHeader ? 'header' : 'none';
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: '401', source }));
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const ADRESSE = z.string().min(5).describe("Adresse complète du bâtiment (ex: '38 bd du Segrais 77185 Lognes')");

app.post('/mcp', mcpLogger, authMiddleware, async (req, res) => {
  const server = new McpServer({ name: 'energyco-data-publiques', version: '1.0.0' });

  server.tool(
    'contexte_batiment',
    "Récupère TOUT le contexte d'un bâtiment français à partir d'une adresse : risques (Géorisques), cadastre, zonage urbanisme (PLU/PLUi). Idéal pour DTG, PPPT, audit énergétique, contexte préalable à toute mission. Appelle en parallèle 3 sources et agrège le résultat.",
    { adresse: ADRESSE },
    async (args) => ({ content: [{ type: 'text', text: await contexteBatimentHandler(args) }] })
  );

  server.tool(
    'georisques_commune',
    "Liste les risques naturels et technologiques d'une commune (PPRN, PPRT, PPRM, radon, sismicité, aléa argile) + arrêtés CatNat depuis 1982. Source : Géorisques / BRGM.",
    { adresse: ADRESSE },
    async (args) => ({ content: [{ type: 'text', text: await georisquesCommuneHandler(args) }] })
  );

  server.tool(
    'cadastre_parcelle',
    "Récupère la/les parcelle(s) cadastrale(s) à une adresse : numéro parcelle, section, surface (m²), géométrie. Source : IGN Apicarto / DGFiP PCI.",
    { adresse: ADRESSE },
    async (args) => ({ content: [{ type: 'text', text: await cadastreParcelleHandler(args) }] })
  );

  server.tool(
    'sirene_entreprise',
    "Recherche dans la base Sirene / INSEE : entreprise par nom OU par numéro SIREN/SIRET. Retourne raison sociale, code NAF, adresse, dirigeants, statut actif/cessé. Utile pour identifier un syndic ou propriétaire.",
    {
      query: z.string().min(2).describe("Nom d'entreprise OU SIREN (9 chiffres) OU SIRET (14 chiffres)"),
      code_postal: z.string().optional().describe('Code postal optionnel pour filtrage géographique'),
    },
    async (args) => ({ content: [{ type: 'text', text: await sireneEntrepriseHandler(args) }] })
  );

  server.tool(
    'plu_zone',
    "Zone PLU/PLUi à une adresse : type de zone (UA, UB, N, A...), servitudes, prescriptions, lien vers règlement. Source : IGN Géoportail Urbanisme.",
    { adresse: ADRESSE },
    async (args) => ({ content: [{ type: 'text', text: await pluZoneHandler(args) }] })
  );

  server.tool(
    'ban_geocode',
    "Géocode une adresse en coordonnées GPS + adresse normalisée + commune + code INSEE. Utilitaire standalone exposé pour diagnostic ou usage direct. Source : Base Adresse Nationale (data.gouv.fr).",
    { adresse: ADRESSE },
    async (args) => ({ content: [{ type: 'text', text: await banGeocodeHandler(args) }] })
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP handler error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

createServer(app).listen(PORT, () => {
  console.log(`energyco-data-publiques listening on port ${PORT}`);
});
