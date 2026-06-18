import type { Context, Config } from "@netlify/functions";
import {
  sheetsGet,
  ONGLET_FORMATEURS,
  ONGLET_DISPONIBILITES,
  ONGLET_PLANNING,
} from "../../lib/sheets.mts";

export default async (req: Request, context: Context) => {
  try {
    const [formateursRaw, disposRaw, planningRaw] = await Promise.all([
      sheetsGet(`'${ONGLET_FORMATEURS}'!A2:H`),
      sheetsGet(`'${ONGLET_DISPONIBILITES}'!A2:H`),
      sheetsGet(`'${ONGLET_PLANNING}'!A1:G`),
    ]);

    const formateurs = formateursRaw
      .filter((r) => r[0])
      .map((r) => ({
        nom: r[0] || "",
        type: r[1] || "",
        lundi: (r[2] || "").toString().trim().toLowerCase() === "oui",
        mardi: (r[3] || "").toString().trim().toLowerCase() === "oui",
        mercredi: (r[4] || "").toString().trim().toLowerCase() === "oui",
        marseille: (r[5] || "").toString().trim().toLowerCase() === "oui",
        actifApartir: r[6] || "",
        notes: r[7] || "",
      }));

    const disponibilites = disposRaw
      .filter((r) => r[1])
      .map((r) => ({
        horodatage: r[0] || "",
        formateur: r[1] || "",
        dateEffective: r[2] || "",
        jourHabituel: r[3] || "",
        type: r[4] || "",
        decale: (r[5] || "").toString().trim().toLowerCase() === "oui",
        periodeDebut: r[6] || "",
        horizonMois: r[7] || "",
      }));

    // Lignes existantes du Planning, indexées par la clé technique (colonne G = lundi ISO)
    const planningExistant: Record<string, string[]> = {};
    planningRaw.slice(1).forEach((r) => {
      if (r[6]) planningExistant[r[6]] = r;
    });

    return new Response(
      JSON.stringify({ formateurs, disponibilites, planningExistant }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ erreur: err.message }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/planning-data",
};
