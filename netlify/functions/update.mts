import type { Context, Config } from "@netlify/functions";
import {
  sheetsGet,
  sheetsBatchUpdate,
  sheetsAppend,
  ONGLET_PLANNING,
  ONGLET_DISPONIBILITES,
  ONGLET_CONFIG,
} from "../../lib/sheets.mts";

async function lireVerrouillage(): Promise<boolean> {
  try {
    const rows = await sheetsGet(`'${ONGLET_CONFIG}'!A:B`);
    const ligne = rows.find((r) => r[0] === "planning_verrouille");
    return ligne ? ligne[1].toString().trim().toLowerCase() === "oui" : false;
  } catch { return false; }
}

async function ecrireVerrouillage(verrouille: boolean): Promise<void> {
  const rows = await sheetsGet(`'${ONGLET_CONFIG}'!A:B`);
  const idx = rows.findIndex((r) => r[0] === "planning_verrouille");
  if (idx >= 0) {
    await sheetsBatchUpdate([{ range: `'${ONGLET_CONFIG}'!B${idx + 1}`, values: [[verrouille ? "oui" : "non"]] }]);
  } else {
    await sheetsAppend(`'${ONGLET_CONFIG}'!A:B`, [["planning_verrouille", verrouille ? "oui" : "non"]]);
  }
}

async function modifierCellulePlanning(lundiISO: string, colonne: string, valeur: string): Promise<void> {
  const planning = await sheetsGet(`'${ONGLET_PLANNING}'!A1:G`);
  const COLONNES: Record<string, string> = { lundi:"B", mardi:"C", mercredi:"D", vendredi:"E", regroupement:"F" };
  const col = COLONNES[colonne];
  if (!col) throw new Error(`Colonne inconnue : ${colonne}`);
  const idx = planning.slice(1).findIndex((r) => r[6] === lundiISO);
  if (idx < 0) throw new Error(`Semaine introuvable : ${lundiISO}`);
  await sheetsBatchUpdate([{ range: `'${ONGLET_PLANNING}'!${col}${idx + 2}`, values: [[valeur]] }]);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405 });
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ erreur: "JSON invalide" }), { status: 400 }); }
  const { action } = body;
  try {
    switch (action) {
      case "get-lock": {
        const verrouille = await lireVerrouillage();
        return new Response(JSON.stringify({ verrouille }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      case "toggle-lock": {
        const actuel = await lireVerrouillage();
        await ecrireVerrouillage(!actuel);
        return new Response(JSON.stringify({ verrouille: !actuel }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      case "lock": {
        await ecrireVerrouillage(true);
        return new Response(JSON.stringify({ ok: true, verrouille: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      case "update-planning": {
        const { lundiISO, colonne, valeur } = body;
        await modifierCellulePlanning(lundiISO, colonne, valeur ?? "");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      default:
        return new Response(JSON.stringify({ erreur: `Action inconnue : ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ erreur: err.message }), { status: 500 });
  }
};

export const config: Config = { path: "/api/update" };
