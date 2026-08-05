<script>
/* ============ WitnessONE architecture flowchart (self-contained SVG) ============ MG
   One picture of the whole solution: device → agent → UI, plus TOP Server,
   templates, records and the central registry DB. Rendered in-app and exportable. */
(function(){
const $=id=>document.getElementById(id);
const FLOW=window.FLOW={};

FLOW.svg=function(){
const W=1180,H=812;
const C={bg:'#0b0e14',lane:'#10141d',line:'#2b3140',txt:'#e8eaf0',txt2:'#9aa3b2',txt3:'#5b6472',
  acc:'#f97316',accd:'#c2410c',teal:'#2ec9de',tealf:'#0e2a30',indigo:'#7e7bf2',good:'#34d399',
  warn:'#fbbf24',red:'#f87171',box:'#141924',boxb:'#2b3140'};
const S=[];
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
function box(x,y,w,h,{fill=C.box,stroke=C.boxb,r=11,dash=null,sw=1.4}={}){
  S.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash?` stroke-dasharray="${dash}"`:''}/>`);}
function txt(x,y,s,{size=13,fill=C.txt,w=600,anchor='start',mono=false}={}){
  S.push(`<text x="${x}" y="${y}" font-family="${mono?'JetBrains Mono,monospace':'Inter,Segoe UI,sans-serif'}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`);}
function chip(x,y,s,col){const w=s.length*6.6+18;
  S.push(`<rect x="${x}" y="${y}" width="${w}" height="19" rx="9.5" fill="none" stroke="${col}" stroke-width="1.1"/>`);
  txt(x+w/2,y+13.5,s,{size:10,fill:col,w:700,anchor:'middle',mono:true});return w;}
function node(x,y,w,h,title,lines,accent){
  box(x,y,w,h,{stroke:accent||C.boxb});
  S.push(`<rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${accent||C.acc}"/>`);
  txt(x+16,y+22,title,{size:13.5,w:800,fill:C.txt});
  (lines||[]).forEach((l,i)=>txt(x+16,y+40+i*15.5,l,{size:11,fill:C.txt2,w:500}));}
// arrow marker + helpers
function arrow(x1,y1,x2,y2,{col=C.acc,dash=null,label=null,mid=null,w=2}={}){
  S.push(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${col}" stroke-width="${w}" fill="none" marker-end="url(#ah)"${dash?` stroke-dasharray="${dash}"`:''}/>`);
  if(label){const mx=mid?mid[0]:(x1+x2)/2,my=mid?mid[1]:(y1+y2)/2;
    const bw=label.length*6.2+12;
    S.push(`<rect x="${mx-bw/2}" y="${my-10}" width="${bw}" height="18" rx="5" fill="${C.bg}" stroke="${C.line}"/>`);
    txt(mx,my+3,label,{size:9.5,fill:C.txt2,w:600,anchor:'middle',mono:true});}}

// ---- frame ----
S.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
txt(34,40,'WitnessONE — solution architecture',{size:22,w:800,fill:C.txt});
txt(34,60,'One double-click app on the commissioning laptop. Everything below runs locally; the only outbound link is the optional central registry DB.',{size:12,fill:C.txt2,w:500});
txt(W-34,40,'v0.4 · MG',{size:12,fill:C.txt3,w:700,anchor:'end'});

// ---- lane: the field (left) ----
box(28,86,300,300,{fill:C.lane,stroke:C.line,r:14});
txt(44,112,'① THE ASSET (field)',{size:12,w:800,fill:C.acc});
node(48,128,260,120,'Vertiv XDU1350B — CDU',
  ['Real equipment under witness test','Modbus TCP slave · port 502 · unit 1','3× pumps · 2× HX · valves · sensors','Registers: 30001… 40001… 10001…'],C.teal);
txt(44,286,'Physical cable',{size:11,fill:C.txt3,w:600});
node(48,300,260,72,'Vendor / Cx engineer',
  ['Operates the unit during tests','(trips a pump, actuates leak…)'],C.warn);

// ---- lane: the laptop (center, big) ----
box(360,86,470,690,{fill:C.lane,stroke:C.line,r:14});
txt(376,112,'② THE COMMISSIONING LAPTOP  — WitnessONE.exe (one file, no install)',{size:12,w:800,fill:C.acc});

// UI
node(384,128,422,132,'WitnessONE UI  (app-mode window)',
  ['3D digital twin · live points table · trends','Register sweep · ＋REG · witnessed test deck','Certificate generator · Help & this flowchart',
   'Runs in Edge/Chrome --app — no browser chrome'],C.acc);
chip(400,232,'HTML · custom 3D engine · offline',C.txt3);

// Agent
node(384,286,422,190,'WitnessONE Agent  (local service :5710)',
  ['Serves the UI to the window (127.0.0.1)','Real Modbus TCP: sweep · block reads · FC06 writes',
   'Persistent connection · READ-ONLY unless ARMED','Template registry · verify / propose / sync',
   'CORS-free proxy to TOP Server APIs'],C.teal);
chip(400,450,'Python stdlib · frozen into the .exe',C.txt3);

// local stores
node(384,500,202,120,'Device templates',
  ['devices/ + pointslists/','SPL REVISIONS — selectable:','v4.17 … SPL 1.0 + field drafts','approved = immutable'],C.indigo);
node(604,500,202,120,'Records (SQLite)',
  ['witnessone_records.db','every witnessed run','+ certificate payload','audit trail on laptop'],C.indigo);

node(384,640,422,120,'Mode selector  (you choose at connect)',
  ['A · SIMULATION — built-in physics model (demo)','B · LIVE — expand, then pick the link:',
   '     🔌 Direct Modbus ◀ field MVP  ·  🗄 TOP Server','Chip always shows the true source'],C.good);

// ---- lane: TOP Server (right top, optional) ----
box(862,86,290,330,{fill:C.lane,stroke:C.line,r:14,});
txt(878,112,'③ TOP SERVER  (optional)',{size:12,w:800,fill:C.acc});
txt(878,130,'Equinix standard — not required for the MVP',{size:10.5,fill:C.txt3,w:500});
node(882,142,252,120,'TOP Server v7.1',
  ['Config API  /config/v1  (Basic auth)','Provisions channel · device · 26 tags',
   'Modbus TCP/IP Ethernet driver','IoT Gateway REST — live values (opt.)'],C.acc);
node(882,282,252,120,'…talks Modbus to the asset',
  ['Same device, same registers','WitnessONE can provision it and','read back through it, OR bypass it','entirely (Direct Modbus).'],C.teal);

// ---- lane: central DB (right bottom) ----
box(862,436,290,340,{fill:C.lane,stroke:C.line,r:14});
txt(878,462,'④ CENTRAL REGISTRY DB  (online)',{size:12,w:800,fill:C.acc});
txt(878,480,'Roadmap — API contract already defined',{size:10.5,fill:C.txt3,w:500});
node(882,492,252,150,'Make / Model / FW / SPL database',
  ['GET  /devices            (pull all)','PATCH /devices/{id}/verify (touch date)',
   'POST /devices/{id}/commits (push change)','Reviewed → published → every','laptop syncs the update'],C.indigo);
node(882,662,252,96,'Certificate vault + dashboards',
  ['Signed certs · pass-rates by vendor','recurring punch items · SSO','(Stage 3)'],C.txt3);

// ================= arrows =================
// asset <-> agent (modbus)
arrow(308,190,384,352,{col:C.teal,label:'Modbus TCP  FC02/03/04',w:2.4});
arrow(384,372,308,352,{col:C.teal,dash:'5 4',label:'FC06 write (ARMED only)',mid:[346,410],w:2});
// vendor operates asset (dashed, human)
arrow(178,300,178,250,{col:C.warn,dash:'4 4',label:'operates',w:1.8});
// UI <-> agent (localhost)
arrow(760,260,760,286,{col:C.acc,label:'HTTP',mid:[760,273],w:2});
// agent -> templates / records
arrow(470,476,470,500,{col:C.indigo,w:1.8});
arrow(700,476,700,500,{col:C.indigo,w:1.8});
// selector feeds UI (up)
arrow(500,640,520,476,{col:C.good,dash:'2 4',w:1.6});
// agent <-> TOP server (proxy). The "…talks Modbus to the asset" box text already
// explains TOP Server reaches the same device, so no crossing Modbus line is drawn.
arrow(806,330,882,240,{col:C.acc,label:'API proxy',mid:[846,286],w:2});
// templates <-> central DB
arrow(586,556,882,556,{col:C.indigo,dash:'6 4',label:'pull / verify / commit',w:2});
// records -> vault
arrow(700,620,900,662,{col:C.txt3,dash:'4 4',label:'archive (Stage 3)',mid:[812,650],w:1.6});

// ---- legend ----
const ly=792;
txt(34,ly,'Data path:',{size:11,fill:C.txt3,w:700});
S.push(`<line x1="112" y1="${ly-4}" x2="146" y2="${ly-4}" stroke="${C.teal}" stroke-width="2.4"/>`);txt(152,ly,'Modbus',{size:11,fill:C.txt2});
S.push(`<line x1="212" y1="${ly-4}" x2="246" y2="${ly-4}" stroke="${C.acc}" stroke-width="2.4"/>`);txt(252,ly,'HTTP / API',{size:11,fill:C.txt2});
S.push(`<line x1="330" y1="${ly-4}" x2="364" y2="${ly-4}" stroke="${C.indigo}" stroke-width="2.4"/>`);txt(370,ly,'registry / storage',{size:11,fill:C.txt2});
S.push(`<line x1="486" y1="${ly-4}" x2="520" y2="${ly-4}" stroke="${C.txt3}" stroke-width="2" stroke-dasharray="4 4"/>`);txt(526,ly,'roadmap / optional',{size:11,fill:C.txt2});
txt(W-34,ly,'Offline-first · outbound only to the central DB, only when online',{size:11,fill:C.txt3,w:600,anchor:'end'});

return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:1180px;display:block">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>
${S.join('\n')}</svg>`;
};

FLOW.open=function(){
  $('flowModal').classList.remove('hidden');
  $('flowHost').innerHTML=FLOW.svg();
};
FLOW.download=function(){
  const svg=FLOW.svg();
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>WitnessONE Architecture</title>
  <style>body{margin:0;background:#0b0e14;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
  </head><body>${svg}</body></html>`;
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download='WitnessONE_Architecture.html';a.click();
};
FLOW.init=function(){
  const c=$('btnFlowClose');if(c)c.onclick=()=>$('flowModal').classList.add('hidden');
  const d=$('btnFlowDl');if(d)d.onclick=()=>FLOW.download();
};
addEventListener('DOMContentLoaded',()=>FLOW.init());
})();
</script>
