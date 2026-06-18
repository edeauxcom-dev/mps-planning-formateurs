import type { Context, Config } from "@netlify/functions";
import { sheetsGet, sheetsAppend, ONGLET_DISPONIBILITES } from "../../lib/sheets.mts";
import { verifierTrousEtAlerter } from "../../lib/gap-check.mts";

const EN_TETE = ["Horodatage", "Formateur", "Date effective", "Jour habituel", "Type", "Décalé", "Période début", "Horizon (mois)"];

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

  const { formateur, horizonMois, periodeDebut, disponibilites } = body;

  if (!formateur || !Array.isArray(disponibilites)) {
    return new Response(
      JSON.stringify({ erreur: "Champs requis manquants (formateur, disponibilites)" }),
      { status: 400 }
    );
  }

  const horodatage = new Date().toISOString();

  const lignes = disponibilites.map((d: any) => [
    horodatage,
    formateur,
    d.dateEffective || "",
    d.jourHabituel || "",
    d.type || "",
    d.decale ? "Oui" : "Non",
    periodeDebut || "",
    horizonMois || "",
  ]);

  try {
    const existant = await sheetsGet(`'${ONGLET_DISPONIBILITES}'!A1:H1`);
    if (existant.length === 0) {
      await sheetsAppend(`'${ONGLET_DISPONIBILITES}'!A:H`, [EN_TETE]);
    }
    await sheetsAppend(`'${ONGLET_DISPONIBILITES}'!A:H`, lignes);
  } catch (err: any) {
    return new Response(JSON.stringify({ erreur: err.message }), { status: 500 });
  }

  let verification = { complet: false, trous: 0, alerteEnvoyee: false };
  try {
    verification = await verifierTrousEtAlerter();
  } catch {
    // La vérification des trous ne doit jamais faire échouer la soumission du formateur.
  }

  return new Response(
    JSON.stringify({ ok: true, nbCreneaux: lignes.length, verification }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config: Config = {
  path: "/api/submit-dispo",
};
