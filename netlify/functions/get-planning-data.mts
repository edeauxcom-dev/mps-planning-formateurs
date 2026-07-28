import type { Context, Config } from "@netlify/functions";
import {
  sheetsGet,
  ONGLET_FORMATEURS,
  ONGLET_DISPONIBILITES,
  ONGLET_PLANNING,
  ONGLET_CONFIG,
} from "../../lib/sheets.mts";

function versTexteDate(valeur: any): string {
  if (typeof valeur === "number") {
    const ms = Math.round((valeur - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return (valeur || "").toString();
}

export default async (req: Request, context: Context) => {
  try {
    const [formateursRaw, disposRaw, planningRaw, configRaw] = await Promise.all([
      sheetsGet(`'${ONGLET_FORMATEURS}'!A2:H`),
      sheetsGet(`'${ONGLET_DISPONIBILITES}'!A2:H`),
      sheetsGet(`'${ONGLET_PLANNING}'!A1:G`),
      sheetsGet(`'${ONGLET_CONFIG}'!A:B`).catch(() => [] as any[][]),
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
        actifApartir: versTexteDate(r[6]),
        notes: r[7] || "",
      }));

    const disponibilites = disposRaw
      .filter((r) => r[1])
      .map((r) => ({
        horodatage: r[0] || "",
        formateur: r[1] || "",
        dateEffective: versTexteDate(r[2]),
        jourHabituel: r[3] || "",
        type: r[4] || "",
        decale: (r[5] || "").toString().trim().toLowerCase() === "oui",
        periodeDebut: versTexteDate(r[6]),
        horizonMois: r[7] || "",
      }));

    const planningExistant: Record<string, any> = {};
    planningRaw.slice(1).forEach((r) => {
      if (r[6]) {
        planningExistant[r[6]] = {
          lundi: r[1] || "",
          mardi: r[2] || "",
          mercredi: r[3] || "",
          vendredi: r[4] || "",
          regroupement: r[5] || "",
          lundiISO: r[6] || "",
        };
      }
    });

    const lockLigne = configRaw.find((r) => r[0] === "planning_verrouille");
    const verrouille = lockLigne ? lockLigne[1].toString().trim().toLowerCase() === "oui" : false;

    return new Response(
      JSON.stringify({ formateurs, disponibilites, planningExistant, verrouille }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ erreur: err.message }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/planning-data",
};
