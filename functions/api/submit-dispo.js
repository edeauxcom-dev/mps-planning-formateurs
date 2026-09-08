import { sheetsGet, sheetsAppend, ONGLET_DISPONIBILITES } from '../../lib/sheets.js';
import { verifierTrousEtAlerter } from '../../lib/gap-check.js';

const EN_TETE = ["Horodatage","Formateur","Date effective","Jour habituel","Type","Décalé","Période début","Horizon (mois)"];

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ erreur: 'JSON invalide' }, { status: 400 }); }

  const { formateur, horizonMois, periodeDebut, disponibilites } = body;
  if (!formateur || !Array.isArray(disponibilites))
    return Response.json({ erreur: 'Champs requis manquants' }, { status: 400 });

  const horodatage = new Date().toISOString();
  const lignes = disponibilites.map(d => [
    horodatage, formateur, d.dateEffective||'', d.jourHabituel||'',
    d.type||'', d.decale ? 'Oui' : 'Non', periodeDebut||'', horizonMois||'',
  ]);

  try {
    const existant = await sheetsGet(env, `'${ONGLET_DISPONIBILITES}'!A1:H1`);
    if (!existant.length) await sheetsAppend(env, `'${ONGLET_DISPONIBILITES}'!A:H`, [EN_TETE]);
    await sheetsAppend(env, `'${ONGLET_DISPONIBILITES}'!A:H`, lignes);
  } catch(err) {
    return Response.json({ erreur: err.message }, { status: 500 });
  }

  let verification = { complet: false, trous: 0, alerteEnvoyee: false };
  try { verification = await verifierTrousEtAlerter(env); } catch {}

  return Response.json({ ok: true, nbCreneaux: lignes.length, verification });
}
