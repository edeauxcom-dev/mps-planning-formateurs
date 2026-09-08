import { sheetsGet, ONGLET_FORMATEURS, ONGLET_DISPONIBILITES } from './sheets.js';

const FORMSPREE_ENDPOINT = "https://formspree.io/f/xkoalolg";
const EMAIL_DESTINATAIRE = "stephanie.d@mypartner-school.fr";
const DATE_NOUVEAU_SCHEMA = new Date(2026, 9, 1);

function estNouveauSchema(d) { return d >= DATE_NOUVEAU_SCHEMA; }
function estDernierDuMois(d) { const s=new Date(d); s.setDate(s.getDate()+7); return s.getMonth()!==d.getMonth(); }
function typeCreneauGC(date, jour) {
  const map={lundi:'NTC',mardi:'CC/CV',mercredi:'MEM'};
  const base=map[jour];
  if (!estNouveauSchema(date)) return base;
  return estDernierDuMois(date) ? base+'_PRESENTIEL' : base;
}
function addDays(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r;}
function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function dateDePaques(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(y,mo-1,day);}
function joursFeries(y){const p=dateDePaques(y);return[new Date(y,0,1),addDays(p,1),new Date(y,4,1),new Date(y,4,8),addDays(p,39),addDays(p,50),new Date(y,6,14),new Date(y,7,15),new Date(y,10,1),new Date(y,10,11),new Date(y,11,25)];}
function estFerie(d,f){return f.some(x=>sameDay(x,d));}
function dernierJeudi(y,m){for(let d=new Date(y,m+1,0).getDate();d>=1;d--){const dt=new Date(y,m,d);if(dt.getDay()===4)return dt;}throw new Error('Aucun jeudi');}
function lundiDeLaSemaine(d){const r=new Date(d);const j=r.getDay();r.setDate(r.getDate()+(j===0?-6:1-j));return r;}
function dateEffective(dh,f){if(estFerie(dh,f)){return{date:addDays(lundiDeLaSemaine(dh),4)};} return{date:dh};}
function formatISO(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function formatCourt(d){return`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;}
function norm(s){return(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function estActif(f,d){const m=(f.actifApartir||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);if(!m)return true;return d>=new Date(+m[3],+m[2]-1,+m[1]);}

export async function verifierTrousEtAlerter(env) {
  const [fr, dr] = await Promise.all([sheetsGet(env,`'${ONGLET_FORMATEURS}'!A2:H`),sheetsGet(env,`'${ONGLET_DISPONIBILITES}'!A2:H`)]);
  const formateurs = fr.filter(r=>r[0]).map(r=>({nom:r[0]||'',type:r[1]||'',lundi:(r[2]||'').toString().trim().toLowerCase()==='oui',mardi:(r[3]||'').toString().trim().toLowerCase()==='oui',mercredi:(r[4]||'').toString().trim().toLowerCase()==='oui',marseille:(r[5]||'').toString().trim().toLowerCase()==='oui',actifApartir:(r[6]||'').toString()}));
  const dispos = dr.filter(r=>r[1]).map(r=>({formateur:(r[1]||'').toString(),dateEffective:(r[2]||'').toString(),type:(r[4]||'').toString()}));

  const debut=lundiDeLaSemaine(new Date());
  const fin=new Date(debut);fin.setMonth(fin.getMonth()+3);
  const dISO=formatISO(debut),fISO=formatISO(fin);

  const tier1=formateurs.filter(f=>f.type.toLowerCase().startsWith('indépendant')&&estActif(f,debut));
  const tier2=formateurs.filter(f=>f.type.toLowerCase().startsWith('fallback'));
  if(!tier1.every(f=>dispos.some(d=>norm(d.formateur)===norm(f.nom)&&d.dateEffective>=dISO&&d.dateEffective<=fISO)))
    return{complet:false,trous:0,alerteEnvoyee:false};

  const feries=[...joursFeries(debut.getFullYear()),...joursFeries(debut.getFullYear()+1)];
  const jMarseille=[];let cur=new Date(debut.getFullYear(),debut.getMonth(),1);
  while(cur<fin){if(!estNouveauSchema(cur))jMarseille.push(dateEffective(dernierJeudi(cur.getFullYear(),cur.getMonth()),feries));cur.setMonth(cur.getMonth()+1);}

  const SLOTS=[{cle:'lundi',jour:'lundi',el:'lundi'},{cle:'mardi',jour:'mardi',el:'mardi'},{cle:'mercredi',jour:'mercredi',el:'mercredi'}];
  const trous=[];let lundi=new Date(debut);
  while(lundi<fin){
    const dim=addDays(lundi,6);
    for(const s of SLOTS){
      const off=s.cle==='lundi'?0:s.cle==='mardi'?1:2;
      const info=dateEffective(addDays(lundi,off),feries);
      const dateISO=formatISO(info.date);
      const type=typeCreneauGC(info.date,s.jour);
      const noms=dispos.filter(d=>d.dateEffective===dateISO&&d.type===type).map(d=>norm(d.formateur));
      const t1=tier1.some(f=>noms.includes(norm(f.nom))&&f[s.el]&&estActif(f,info.date));
      const t2=tier2.some(f=>f[s.el]&&estActif(f,info.date));
      if(!t1&&!t2)trous.push(`${type} du ${formatCourt(info.date)}`);
    }
    const m=jMarseille.find(jm=>jm.date>=lundi&&jm.date<=dim);
    if(m){const dateISO=formatISO(m.date);const noms=dispos.filter(d=>d.dateEffective===dateISO&&d.type==='MARSEILLE').map(d=>norm(d.formateur));if(!tier1.some(f=>noms.includes(norm(f.nom))&&f.marseille&&estActif(f,m.date))&&!tier2.some(f=>f.marseille&&estActif(f,m.date)))trous.push(`Regroupement du ${formatCourt(m.date)}`);}
    lundi=addDays(lundi,7);
  }

  let alerteEnvoyee=false;
  if(trous.length){
    try{
      await fetch(FORMSPREE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({_subject:`⚠️ ${trous.length} créneau(x) non couvert(s) — Planning MPS`,email:EMAIL_DESTINATAIRE,message:`Trous détectés :\n${trous.map(t=>`- ${t}`).join('\n')}`})});
      alerteEnvoyee=true;
    }catch{}
  }
  return{complet:true,trous:trous.length,alerteEnvoyee};
}
