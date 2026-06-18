import type { Context, Config } from "@netlify/functions";
import {
  sheetsGet,
  sheetsAppend,
  sheetsBatchUpdate,
  ONGLET_PLANNING,
} from "../../lib/sheets.mts";

// Colonnes du Planning : A=Semaine, B=Lundi, C=Mardi, D=Mercredi, E=Vendredi, F=Regroupement, G=LundiISO (clé technique)
const COLONNES = ["B", "C", "D", "E", "F"] as const;
const CLES = ["lundi", "mardi", "mercredi", "vendredi", "regroupement"] as const;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Méthode non autorisée", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ erreur: "JSON invalide" }), { status: 400 });
  }

  const semaines = body.semaines;
  if (!Array.isArray(semaines)) {
    return new Response(JSON.stringify({ erreur: "Champ 'semaines' manquant" }), { status: 400 });
  }

  try {
    let planningActuel = await sheetsGet(`'${ONGLET_PLANNING}'!A1:G`);

    if (planningActuel.length === 0) {
      await sheetsAppend(`'${ONGLET_PLANNING}'!A:G`, [
        ["Semaine", "Lundi (NTC)", "Mardi (CC/CV)", "Mercredi (MEM)", "Vendredi (décalage férié)", "Regroupement (Marseille)", "Lundi ISO"],
      ]);
      planningActuel = [["Semaine", "Lundi (NTC)", "Mardi (CC/CV)", "Mercredi (MEM)", "Vendredi (décalage férié)", "Regroupement (Marseille)", "Lundi ISO"]];
    }

    const lignesExistantes = planningActuel.slice(1); // ignore l'en-tête

    const indexParCle: Record<string, number> = {}; // lundiISO -> index dans lignesExistantes (0-based)
    lignesExistantes.forEach((r, i) => {
      if (r[6]) indexParCle[r[6]] = i;
    });

    const misesAJour: { range: string; values: any[][] }[] = [];
    const nouvellesLignes: any[][] = [];
    let casesRemplies = 0;
    let casesIgnorees = 0;

    for (const semaine of semaines) {
      const idx = indexParCle[semaine.lundiISO];

      if (idx !== undefined) {
        const ligne = lignesExistantes[idx];
        const numeroLigne = idx + 2; // +2 car en-tête en ligne 1, index 0-based

        CLES.forEach((cle, i) => {
          const valeurActuelle = (ligne[i + 1] || "").toString().trim();
          const valeurProposee = (semaine[cle] || "").toString().trim();
          if (!valeurActuelle && valeurProposee) {
            misesAJour.push({
              range: `'${ONGLET_PLANNING}'!${COLONNES[i]}${numeroLigne}`,
              values: [[valeurProposee]],
            });
            casesRemplies++;
          } else if (valeurActuelle && valeurProposee && valeurActuelle !== valeurProposee) {
            casesIgnorees++;
          }
        });
      } else {
        nouvellesLignes.push([
          semaine.label || "",
          semaine.lundi || "",
          semaine.mardi || "",
          semaine.mercredi || "",
          semaine.vendredi || "",
          semaine.regroupement || "",
          semaine.lundiISO || "",
        ]);
        casesRemplies += CLES.filter((cle) => semaine[cle]).length;
      }
    }

    await sheetsBatchUpdate(misesAJour);
    if (nouvellesLignes.length > 0) {
      await sheetsAppend(`'${ONGLET_PLANNING}'!A:G`, nouvellesLignes);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        nouvellesLignes: nouvellesLignes.length,
        casesRemplies,
        casesIgnoreesDejaRemplies: casesIgnorees,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ erreur: err.message }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/save-planning",
};
