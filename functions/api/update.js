import { sheetsGet, sheetsAppend, sheetsBatchUpdate, ONGLET_PLANNING, ONGLET_CONFIG } from '../../lib/sheets.js';

const COLONNES = { lundi:1, mardi:2, mercredi:3, vendredi:4, regroupement:5 };
const COL_LETTRES = { lundi:"B", mardi:"C", mercredi:"D", vendredi:"E", regroupement:"F" };

async function lireVerrouillage(env) {
  try {
    const rows = await sheetsGet(env, `'${ONGLET_CONFIG}'!A:B`);
    const l = rows.find(r => r[0]==='planning_verrouille');
    return l ? l[1].toString().trim().toLowerCase()==='oui' : false;
  } catch { return false; }
}

async function ecrireVerrouillage(env, v) {
  const rows = await sheetsGet(env, `'${ONGLET_CONFIG}'!A:B`);
  const idx = rows.findIndex(r => r[0]==='planning_verrouille');
  if (idx >= 0) await sheetsBatchUpdate(env, [{ range: `'${ONGLET_CONFIG}'!B${idx+1}`, values: [[v?'oui':'non']] }]);
  else await sheetsAppend(env, `'${ONGLET_CONFIG}'!A:B`, [['planning_verrouille', v?'oui':'non']]);
}

async function modifierCellulePlanning(env, lundiISO, colonne, valeur) {
  const colIdx = COLONNES[colonne];
  if (colIdx === undefined) throw new Error(`Colonne inconnue : ${colonne}`);

  let planning = await sheetsGet(env, `'${ONGLET_PLANNING}'!A1:G`);
  if (!planning.length) {
    await sheetsAppend(env, `'${ONGLET_PLANNING}'!A:G`, [["Semaine","Lundi (NTC)","Mardi (CC/CV)","Mercredi (MEM)","Vendredi (décalage férié)","Regroupement (Marseille)","Lundi ISO"]]);
    planning = await sheetsGet(env, `'${ONGLET_PLANNING}'!A1:G`);
  }

  const lignes = planning.slice(1);
  const idx = lignes.findIndex(r => r[6]===lundiISO);
  if (idx >= 0) {
    await sheetsBatchUpdate(env, [{ range: `'${ONGLET_PLANNING}'!${COL_LETTRES[colonne]}${idx+2}`, values: [[valeur]] }]);
  } else {
    const nl = ['','','','','','',lundiISO];
    nl[colIdx] = valeur;
    await sheetsAppend(env, `'${ONGLET_PLANNING}'!A:G`, [nl]);
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ erreur: 'JSON invalide' }, { status: 400 }); }

  try {
    switch(body.action) {
      case 'get-lock':
        return Response.json({ verrouille: await lireVerrouillage(env) });
      case 'toggle-lock': {
        const actuel = await lireVerrouillage(env);
        await ecrireVerrouillage(env, !actuel);
        return Response.json({ verrouille: !actuel });
      }
      case 'lock':
        await ecrireVerrouillage(env, true);
        return Response.json({ ok: true, verrouille: true });
      case 'update-planning':
        await modifierCellulePlanning(env, body.lundiISO, body.colonne, body.valeur ?? 'NON_COUVERT');
        return Response.json({ ok: true });
      default:
        return Response.json({ erreur: `Action inconnue : ${body.action}` }, { status: 400 });
    }
  } catch(err) {
    return Response.json({ erreur: err.message }, { status: 500 });
  }
}
