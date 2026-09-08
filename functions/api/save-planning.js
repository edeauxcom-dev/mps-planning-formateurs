import { sheetsGet, sheetsAppend, sheetsBatchUpdate, ONGLET_PLANNING } from '../../lib/sheets.js';

const EN_TETE = ["Semaine","Lundi (NTC)","Mardi (CC/CV)","Mercredi (MEM)","Vendredi (décalage férié)","Regroupement (Marseille)","Lundi ISO"];
const COLONNES = { lundi:"B", mardi:"C", mercredi:"D", vendredi:"E", regroupement:"F" };

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ erreur: 'JSON invalide' }, { status: 400 }); }

  const semaines = body.semaines;
  if (!Array.isArray(semaines))
    return Response.json({ erreur: "Champ 'semaines' manquant" }, { status: 400 });

  try {
    let planningActuel = await sheetsGet(env, `'${ONGLET_PLANNING}'!A1:G`);
    if (!planningActuel.length) {
      await sheetsAppend(env, `'${ONGLET_PLANNING}'!A:G`, [EN_TETE]);
      planningActuel = [EN_TETE];
    }

    const lignesExistantes = planningActuel.slice(1);
    const indexParCle = {};
    lignesExistantes.forEach((r, i) => { if (r[6]) indexParCle[r[6]] = i; });

    const misesAJour = [];
    const nouvellesLignes = [];
    let casesRemplies = 0, casesIgnorees = 0;

    for (const semaine of semaines) {
      const idx = indexParCle[semaine.lundiISO];
      if (idx !== undefined) {
        const ligne = lignesExistantes[idx];
        const num = idx + 2;
        ['lundi','mardi','mercredi','vendredi','regroupement'].forEach((cle, i) => {
          const valAct = (ligne[i+1]||'').toString().trim();
          const valProp = (semaine[cle]||'').toString().trim();
          if (!valAct && valProp) { misesAJour.push({ range: `'${ONGLET_PLANNING}'!${COLONNES[cle]}${num}`, values: [[valProp]] }); casesRemplies++; }
          else if (valAct && valProp && valAct !== valProp) casesIgnorees++;
        });
      } else {
        nouvellesLignes.push([semaine.label||'', semaine.lundi||'', semaine.mardi||'', semaine.mercredi||'', semaine.vendredi||'', semaine.regroupement||'', semaine.lundiISO||'']);
        casesRemplies += ['lundi','mardi','mercredi','vendredi','regroupement'].filter(c => semaine[c]).length;
      }
    }

    await sheetsBatchUpdate(env, misesAJour);
    if (nouvellesLignes.length) await sheetsAppend(env, `'${ONGLET_PLANNING}'!A:G`, nouvellesLignes);

    return Response.json({ ok: true, nouvellesLignes: nouvellesLignes.length, casesRemplies, casesIgnoreesDejaRemplies: casesIgnorees });
  } catch(err) {
    return Response.json({ erreur: err.message }, { status: 500 });
  }
}
