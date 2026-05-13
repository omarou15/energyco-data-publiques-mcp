import { geocodeBAN } from './shared/ban-client.js';

export async function banGeocodeHandler({ adresse }) {
  const t0 = Date.now();
  try {
    const ban = await geocodeBAN(adresse);
    console.log(JSON.stringify({ tool: 'ban_geocode', duration_ms: Date.now() - t0, ok: true }));
    return JSON.stringify({ source: 'BAN', adresse_input: adresse, ...ban });
  } catch (err) {
    console.log(JSON.stringify({ tool: 'ban_geocode', duration_ms: Date.now() - t0, ok: false, error: err.message }));
    return JSON.stringify({ source: 'BAN', adresse_input: adresse, error: err.message });
  }
}
