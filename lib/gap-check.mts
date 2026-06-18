import { sheetsGet, ONGLET_FORMATEURS, ONGLET_DISPONIBILITES } from "./sheets.mts";

// Formulaire Formspree dédié, créé spécifiquement pour cette alerte
// (notification configurée sur stephanie.d@mypartner-school.fr).
const FORMSPREE_ENDPOINT = "https://formspree.io/f/xkoalolg";
const EMAIL_DESTINATAIRE_INFO = "stephanie.d@mypartner-school.fr";

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateDePaques(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function joursFeriesFR(year: number): Date[] {
  const p = dateDePaques(year);
  return [new Date(year, 0, 1), addDays(p, 1), new Date(year, 4, 1), new Date(year, 4, 8), addDays(p, 39), addDays(p, 50),
    new Date(year, 6, 14), new Date(year, 7, 15), new Date(year, 10, 1), new Date(year, 10, 11), new Date(year, 11, 25)];
}
function estFerie(date: Date, feries: Date[]): boolean {
  return feries.some((f) => sameDay(f, date));
}
function dernierJeudi(year: number, monthIndex: number): Date {
  const dernierJour = new Date(year, monthIndex + 1, 0).getDate();
  for (let d = dernierJour; d >= 1; d--) {
    const date = new Date(year, monthIndex, d);
    if (date.getDay() === 4) return date;
  }
  throw new Error("Aucun jeudi trouvé dans le mois");
}
function lundiDeLaSemaine(date: Date): Date {
  const d = new Date(date);
  const jour = d.getDay();
  return addDays(d, jour === 0 ? -6 : 1 - jour);
}
function dateEffectiveCalc(dateHabituelle: Date, feries: Date[]) {
  if (estFerie(dateHabituelle, feries)) {
    return { date: addDays(lundiDeLaSemaine(dateHabituelle), 4), decalee: true };
  }
  return { date: dateHabituelle, decalee: false };
}
function formatISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function formatDateCourt(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function normaliserNom(nom: string): string {
  return (nom || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function estActif(formateur: any, dateSlot: Date): boolean {
  const m = (formateur.actifApartir || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return true;
  const dateActivation = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  return dateSlot >= dateActivation;
}

async function chargerDonnees() {
  const [formateursRaw, disposRaw] = await Promise.all([
    sheetsGet(`'${ONGLET_FORMATEURS}'!A2:H`),
    sheetsGet(`'${ONGLET_DISPONIBILITES}'!A2:H`),
  ]);
  const formateurs = formateursRaw.filter((r) => r[0]).map((r) => ({
    nom: r[0] || "", type: r[1] || "",
    lundi: (r[2] || "").toString().trim().toLowerCase() === "oui",
    mardi: (r[3] || "").toString().trim().toLowerCase() === "oui",
    mercredi: (r[4] || "").toString().trim().toLowerCase() === "oui",
    marseille: (r[5] || "").toString().trim().toLowerCase() === "oui",
    actifApartir: (r[6] || "").toString(),
  }));
  const disponibilites = disposRaw.filter((r) => r[1]).map((r) => ({
    formateur: (r[1] || "").toString(),
    dateEffective: (r[2] || "").toString(),
    type: (r[4] || "").toString(),
  }));
  return { formateurs, disponibilites };
}

/**
 * Vérifie si tous les formateurs indépendants actifs ont soumis leurs dispos
 * pour les 3 prochains mois ; si oui, détecte les trous et alerte par e-mail
 * (Formspree) s'il y en a. Conçu pour être appelé après chaque soumission —
 * ne fait rien tant que tout le monde n'a pas répondu.
 */
export async function verifierTrousEtAlerter(): Promise<{ complet: boolean; trous: number; alerteEnvoyee: boolean }> {
  const { formateurs, disponibilites } = await chargerDonnees();

  const debut = lundiDeLaSemaine(new Date());
  const fin = new Date(debut);
  fin.setMonth(fin.getMonth() + 3);
  const debutISO = formatISO(debut);
  const finISO = formatISO(fin);

  const tier1 = formateurs.filter((f) => f.type.toLowerCase().startsWith("indépendant") && estActif(f, debut));
  const tier2 = formateurs.filter((f) => f.type.toLowerCase().startsWith("fallback"));

  const aSoumisPourLaPeriode = (nom: string) =>
    disponibilites.some(
      (d) => normaliserNom(d.formateur) === normaliserNom(nom) && d.dateEffective >= debutISO && d.dateEffective <= finISO
    );

  const tousOntSoumis = tier1.every((f) => aSoumisPourLaPeriode(f.nom));
  if (!tousOntSoumis) {
    return { complet: false, trous: 0, alerteEnvoyee: false };
  }

  // Construction des semaines + détection des trous (existence d'un candidat, sans calcul de rotation)
  const feries = [...joursFeriesFR(debut.getFullYear()), ...joursFeriesFR(debut.getFullYear() + 1)];
  const journeesMarseille: { date: Date; decalee: boolean }[] = [];
  let curseur = new Date(debut.getFullYear(), debut.getMonth(), 1);
  while (curseur < fin) {
    journeesMarseille.push(dateEffectiveCalc(dernierJeudi(curseur.getFullYear(), curseur.getMonth()), feries));
    curseur.setMonth(curseur.getMonth() + 1);
  }

  const SLOTS = [
    { cle: "lundi", type: "NTC", eligible: "lundi" as const },
    { cle: "mardi", type: "CC/CV", eligible: "mardi" as const },
    { cle: "mercredi", type: "MEM", eligible: "mercredi" as const },
  ];

  const trousDetail: string[] = [];
  let lundi = new Date(debut);
  while (lundi < fin) {
    const dimanche = addDays(lundi, 6);
    for (const slot of SLOTS) {
      const offset = slot.cle === "lundi" ? 0 : slot.cle === "mardi" ? 1 : 2;
      const info = dateEffectiveCalc(addDays(lundi, offset), feries);
      const dateISO = formatISO(info.date);
      const dispoNoms = disponibilites
        .filter((d) => d.dateEffective === dateISO && d.type === slot.type)
        .map((d) => normaliserNom(d.formateur));
      const aUnTier1 = tier1.some((f) => dispoNoms.includes(normaliserNom(f.nom)) && (f as any)[slot.eligible] && estActif(f, info.date));
      const aUnTier2 = tier2.some((f) => (f as any)[slot.eligible] && estActif(f, info.date));
      if (!aUnTier1 && !aUnTier2) {
        trousDetail.push(`${slot.type} du ${formatDateCourt(info.date)}`);
      }
    }
    const marseille = journeesMarseille.find((jm) => jm.date >= lundi && jm.date <= dimanche);
    if (marseille) {
      const dateISO = formatISO(marseille.date);
      const dispoNoms = disponibilites.filter((d) => d.dateEffective === dateISO && d.type === "MARSEILLE").map((d) => normaliserNom(d.formateur));
      const aUnTier1 = tier1.some((f) => dispoNoms.includes(normaliserNom(f.nom)) && f.marseille && estActif(f, marseille.date));
      const aUnTier2 = tier2.some((f) => f.marseille && estActif(f, marseille.date));
      if (!aUnTier1 && !aUnTier2) {
        trousDetail.push(`Regroupement Marseille du ${formatDateCourt(marseille.date)}`);
      }
    }
    lundi = addDays(lundi, 7);
  }

  let alerteEnvoyee = false;
  if (trousDetail.length > 0) {
    try {
      await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: `⚠️ ${trousDetail.length} créneau(x) non couvert(s) — Planning formateurs MPS`,
          email: EMAIL_DESTINATAIRE_INFO,
          message:
            `Tous les formateurs indépendants ont rempli leurs disponibilités pour les 3 prochains mois, ` +
            `mais ${trousDetail.length} créneau(x) restent sans personne disponible (ni indépendant ni filet de sécurité) :\n\n` +
            trousDetail.map((t) => `- ${t}`).join("\n"),
        }),
      });
      alerteEnvoyee = true;
    } catch {
      alerteEnvoyee = false;
    }
  }

  return { complet: true, trous: trousDetail.length, alerteEnvoyee };
}
