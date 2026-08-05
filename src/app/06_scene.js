<script>
/* ============ WitnessONE HoloTwin engine — stylized XDU1350B digital twin ============
   Zero-dependency 3D: painter's-algorithm canvas renderer with holographic shading.
   Runs anywhere (factory laptop, offline, headless) — no WebGL, no CDN.
   Proportions per Vertiv XDU1350B guides: 900 × 1243 × 2122 mm (W:D:H = 1:1.38:2.36).
   Zones (real service layout): pumps low · plate HX mid · expansion vessels high.  MG */
(function(){
const SCENE=window.SCENE={};
let W=0.9, D=1.243, H=2.122;
let TPL=()=>window.W1_ACTIVE_TEMPLATE||{identity:{make:'VERTIV',model:'XDU1350B',firmwares:['1.0']},class:'CDU',id:'vertiv-xdu1350b-cdu'};
let isCDU=true; let hasCabinet=true; let R0=4.9; const genLapHist={}; const DB=()=>window.SPL_DB;
const CLS=()=>String(TPL().class||'').toUpperCase();
function applyDims(){
  const t=TPL();isCDU=(t.id==='vertiv-xdu1350b-cdu');
  const d=(t.layout&&t.layout.dims_mm)||{w:900,d:1243,h:2122};
  // scale to metres, clamp so any asset sits nicely on the same stage
  W=Math.max(.4,Math.min(1.5,d.w/1000));
  D=Math.max(.4,Math.min(1.5,d.d/1000));
  H=Math.max(.8,Math.min(2.4,d.h/1000));
  // non-cabinet assets (true form factors researched from vendor docs) get their
  // own stage envelope — the real device dims stay in the template + labels
  const c=CLS();hasCabinet=!(c.includes('METER')||c.includes('BREAKER'));
  if(c.includes('METER')){W=.95;D=.85;H=1.8;R0=3.5;}        // 96×96×77.5 mm panel meter on a Cx stand
  else if(c.includes('BREAKER')){W=1.15;D=1.0;H=1.5;R0=4.0;} // E2.2 ACB block on a test plinth
  else R0=4.9;
}
const RMOTION=(typeof matchMedia!=='undefined')&&matchMedia('(prefers-reduced-motion: reduce)').matches;
let cv,ctx,CW,CH,f;
let mode='boot', xray=false, xrayT=0;
let orbit={r:5.2,az:-0.62,el:0.34,ty:1.02,vaz:0,vel:0,auto:true};
let t0=performance.now(), tPrev=0, shellA=0; // shell alpha 0 until assembled
let assembling=false, asmT=0, asmCb=null;

/* ---------- tiny vec math ---------- */
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const nrm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
const LIGHT=nrm([0.45,0.8,0.35]);

/* ---------- camera ---------- */
let eye=[0,0,0],R=[1,0,0],U=[0,1,0],F=[0,0,1];
function camUpdate(){
  const ce=Math.cos(orbit.el),se=Math.sin(orbit.el),ca=Math.cos(orbit.az),sa=Math.sin(orbit.az);
  eye=[orbit.r*ce*sa, orbit.ty+orbit.r*se, orbit.r*ce*ca];
  const tgt=[0,orbit.ty,0];
  F=nrm(sub(tgt,eye)); R=nrm(cross(F,[0,1,0])); U=cross(R,F);
  f=(CH/2)/Math.tan(22*Math.PI/180);
}
function proj(v,out){ // returns null if behind camera
  const p=sub(v,eye);
  const z=dot(p,F); if(z<0.12)return null;
  out[0]=CW/2+dot(p,R)*f/z; out[1]=CH/2-dot(p,U)*f/z; out[2]=z; return out;
}
const fog=z=>Math.max(0,Math.min(1,1-(z-5.5)/13));

/* ---------- primitive store ---------- */
// face: {p:[v3×n], col:[r,g,b], a, edge:[r,g,b], ea, decal, tag}
const shell=[], solid=[], inner=[], pylonF=[], groundL=[], labels3=[];
function quad(list,a,b,c,d,col,al,edge,ea,tag){list.push({p:[a,b,c,d],col,a:al,edge,ea,tag});}
function boxP(list,cx,cy,cz,w,h,d,col,al,edge,ea,tag){
  const x0=cx-w/2,x1=cx+w/2,y0=cy-h/2,y1=cy+h/2,z0=cz-d/2,z1=cz+d/2;
  const v=[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]];
  quad(list,v[0],v[1],v[2],v[3],col,al,edge,ea,tag); // front +z
  quad(list,v[5],v[4],v[7],v[6],col,al,edge,ea,tag); // back
  quad(list,v[1],v[5],v[6],v[2],col,al,edge,ea,tag); // right
  quad(list,v[4],v[0],v[3],v[7],col,al,edge,ea,tag); // left
  quad(list,v[3],v[2],v[6],v[7],col,al,edge,ea,tag); // top
  quad(list,v[4],v[5],v[1],v[0],col,al,edge,ea,tag); // bottom
}
function cylP(list,cx,cy,cz,r,h,n,col,al,edge,ea,tag){
  const pts=[];for(let i=0;i<n;i++){const a=i/n*Math.PI*2;pts.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r]);}
  for(let i=0;i<n;i++){const p0=pts[i],p1=pts[(i+1)%n];
    quad(list,[p1[0],cy-h/2,p1[1]],[p0[0],cy-h/2,p0[1]],[p0[0],cy+h/2,p0[1]],[p1[0],cy+h/2,p1[1]],col,al,edge,ea,tag);}
  list.push({p:pts.map(p=>[p[0],cy+h/2,p[1]]),col,a:al,edge,ea,tag});
  list.push({p:pts.slice().reverse().map(p=>[p[0],cy-h/2,p[1]]),col,a:al,edge,ea,tag});
}

/* ---------- palette ---------- */
const C_PANEL=[22,26,36], C_EDGE=[255,146,60], C_FRAME=[16,19,27], C_STEEL=[176,188,200],
      C_STEELD=[120,130,142], C_TEAL=[46,201,222], C_INDIGO=[157,155,255], C_RED=[214,72,72],
      C_ORANGE=[249,115,22];

/* ---------- build geometry ---------- */
let doorQuad, hmiQuad, screenGlowP=[0,1.6,D/2+.03];
const pipeStubs=[], anchors=[]; // anchors: {p,r,pt,name}
function build(){
  const cls0=CLS();
  if(!hasCabinet&&cls0.includes('METER'))buildMeterAsset();
  else if(!hasCabinet)buildBreakerAsset();
  else{
  // frame & tray
  boxP(solid,0,.1,0,W-.06,.06,D-.06,C_FRAME,1,C_EDGE,.22);
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
    boxP(solid,sx*(W/2-.1),.035,sz*(D/2-.12),.07,.07,.07,[8,9,12],1,null,0);
    boxP(solid,sx*(W/2-.03),(H-.14)/2+.13,sz*(D/2-.03),.05,H-.14,.05,C_FRAME,1,C_EDGE,.13);});
  // shell panels
  const P=(cx,cy,cz,w,h,d)=>boxP(shell,cx,cy,cz,w,h,d,C_PANEL,1,C_EDGE,.5);
  P(-(W/2-.012),(H-.2)/2+.13,0,.024,H-.2,D-.08);
  P((W/2-.012),(H-.2)/2+.13,0,.024,H-.2,D-.08);
  P(0,(H-.2)/2+.13,-(D/2-.012),W-.08,H-.2,.024);
  P(0,H-.015,0,W-.04,.03,D-.04);
  // front door (kept as its own quad for decal)
  const y0=.13,y1=H-.07,x0=-(W/2-.04),x1=(W/2-.04),z=D/2-.014;
  doorQuad={p:[[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]],col:C_PANEL,a:1,edge:C_EDGE,ea:.6,decal:'door'};
  shell.push(doorQuad);
  // HMI screen quad (front door, upper third)
  const sw=.27,sh=.158,sy=1.6;
  hmiQuad={p:[[-sw/2,sy-sh/2,z+.004],[sw/2,sy-sh/2,z+.004],[sw/2,sy+sh/2,z+.004],[-sw/2,sy+sh/2,z+.004]],
    col:[10,20,32],a:1,edge:[70,160,200],ea:.9,decal:'hmi'};
  shell.push(hmiQuad);
  SCENE._attach=[-.32,.09,D/2+.01];
  SCENE._scrGlow=[0,sy,z+.05];
  if(isCDU) buildCDUInterior();
  else buildGenericInterior();
  }
  // ---- Cx laptop station — the toolbox itself (WitnessONE + TOP Server run here) ----
  const PX=-1.42,PZ=-0.28,YAW=-0.21,TT=.78,TILT=.36;
  const LP=p=>{const c=Math.cos(YAW),s=Math.sin(YAW);
    return [PX+p[0]*c+p[2]*s, p[1], PZ-p[0]*s+p[2]*c];};
  function boxY(cx,cy,cz,w,h,d,col,al,edge,ea){
    const x0=cx-w/2,x1=cx+w/2,y0=cy-h/2,y1=cy+h/2,z0=cz-d/2,z1=cz+d/2;
    const v=[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]].map(LP);
    quad(pylonF,v[0],v[1],v[2],v[3],col,al,edge,ea);quad(pylonF,v[5],v[4],v[7],v[6],col,al,edge,ea);
    quad(pylonF,v[1],v[5],v[6],v[2],col,al,edge,ea);quad(pylonF,v[4],v[0],v[3],v[7],col,al,edge,ea);
    quad(pylonF,v[3],v[2],v[6],v[7],col,al,edge,ea);quad(pylonF,v[4],v[5],v[1],v[0],col,al,edge,ea);}
  // commissioning cart
  boxY(0,TT+.015,0,.62,.03,.45,[20,24,33],1,C_EDGE,.5);
  [[-.28,-.19],[.28,-.19],[-.28,.19],[.28,.19]].forEach(([lx,lz])=>boxY(lx,TT/2,lz,.03,TT,.03,[14,17,24],1,C_EDGE,.16));
  boxY(0,.2,0,.56,.022,.4,[18,21,30],1,C_EDGE,.22);
  // laptop base (keyboard deck) + side network port
  boxY(0,TT+.048,.03,.5,.028,.33,[15,18,26],1,[46,201,222],.5);
  boxY(.262,TT+.048,.06,.028,.024,.05,[26,30,40],1,[46,201,222],.9);
  // laptop screen (hinged at rear, tilted back)
  const lca=Math.cos(TILT),lsa=Math.sin(TILT),hz=-.135,hy=TT+.062,SH=.33;
  quad(pylonF,LP([-.25,hy,hz]),LP([.25,hy,hz]),LP([.25,hy+SH*lca,hz-SH*lsa]),LP([-.25,hy+SH*lca,hz-SH*lsa]),
    [13,16,23],1,C_EDGE,.6);
  const ln=[0,lsa,lca],loff=.012,lin=.016;
  const lpt=(lx,d2)=>[lx,hy+d2*lca+ln[1]*loff,hz-d2*lsa+ln[2]*loff];
  pylonF.push({p:[LP(lpt(-.25+lin,lin)),LP(lpt(.25-lin,lin)),LP(lpt(.25-lin,SH-lin)),LP(lpt(-.25+lin,SH-lin))],
    col:[8,12,20],a:1,edge:[46,201,222],ea:.85,decal:'lap'});
  SCENE._pyl=LP([0,hy+SH*.5*lca,hz-SH*.5*lsa]);
  // comms port on the asset + patch cable: device port → floor → up the cart → laptop side port
  const AP=SCENE._attach||[-.32,.09,.635];
  boxP(solid,AP[0],AP[1],AP[2],.06,.06,.05,[26,30,40],1,C_TEAL,.55);
  SCENE._cable=[[AP[0],AP[1],AP[2]+.03],[-.5,.03,Math.max(.35,AP[2])],[-.82,.03,.48],[-1.1,.03,.14],
    LP([.42,.03,.14]),LP([.36,.42,.09]),LP([.30,TT+.02,.06]),LP([.276,TT+.048,.06])];
  // ground rings
  for(let r=0.9;r<=4.6;r+=0.75){const pts=[];for(let i=0;i<=72;i++){const a=i/72*Math.PI*2;
    pts.push([Math.cos(a)*r,0,Math.sin(a)*r]);}groundL.push({pts,c:'rgba(249,115,22,',a:.10});}
  for(let a=0;a<16;a++){const th=a/16*Math.PI*2;
    groundL.push({pts:[[Math.cos(th)*.9,0,Math.sin(th)*.9],[Math.cos(th)*4.6,0,Math.sin(th)*4.6]],c:'rgba(148,163,184,',a:.05});}
  // labels (CDU only; generic interior sets its own)
  if(isCDU){
    labels3.push({p:[0,.56,.85],t:'PUMPS ×3',s:'VSD · N+1 REDUNDANT'});
    labels3.push({p:[0,1.3,.85],t:'PLATE HX ×2',s:'LIQUID-TO-LIQUID'});
    labels3.push({p:[0,2.0,-.9],t:'EXPANSION 3×8 L',s:'+ RELIEF VALVE'});
    labels3.push({p:[-.9,.86,-.6],t:'CV1 · CV2',s:'2-WAY · 40 s STROKE'});
  }
  SCENE._pylLabel={p:[PX,1.46,PZ],t:'CX LAPTOP — WITNESSONE',s:'DIRECT MODBUS TCP · TOP SERVER OPTIONAL'};
}

/* ---- CDU interior (rich model) ---- */
function buildCDUInterior(){
  boxP(solid,0,H+.06,D/2-.28,.5,.12,.34,C_FRAME,1,C_EDGE,.35,'power');
  [[-.3,C_INDIGO],[-.12,C_INDIGO],[.12,C_TEAL],[.3,C_TEAL]].forEach(([px,cc])=>{
    cylP(solid,px,H+.2,-(D/2-.24),.057,.46,10,C_STEEL,1,null,0);
    cylP(solid,px,H+.12,-(D/2-.24),.06,.05,10,cc,1,null,0);
    cylP(solid,px,H+.34,-(D/2-.24),.068,.03,10,C_STEELD,1,null,0);
    pipeStubs.push([px,H+.43,-(D/2-.24),cc]);});
  [-.26,0,.26].forEach((px,i)=>{
    cylP(inner,px,.36,-.18,.09,.4,10,C_STEEL,1,null,0,'pump'+i);
    cylP(inner,px,.64,-.18,.066,.17,10,C_STEELD,1,null,0,'pump'+i);
    boxP(inner,px,.95,-.32,.11,.17,.05,[28,33,44],1,C_TEAL,.25,'vfd'+i);
    anchors.push({p:[px,.5,-.18],r:.28,pt:'P03',name:'Pump P'+(i+1)});});
  [-.2,.2].forEach(px=>{boxP(inner,px,1.18,.16,.3,.92,.4,C_STEELD,1,C_TEAL,.3,'hx');
    anchors.push({p:[px,1.18,.16],r:.5,pt:'P08',name:'Plate HX'});});
  boxP(inner,-.24,.78,-.33,.2,.14,.3,C_STEELD,1,null,0,'valve');
  cylP(inner,-.24,.9,-.38,.05,.045,8,C_ORANGE,1,null,0,'valve');
  cylP(inner,-.24,.9,-.28,.05,.045,8,C_ORANGE,1,null,0,'valve');
  anchors.push({p:[-.24,.85,-.33],r:.3,pt:'P05',name:'Control valves CV1/CV2'});
  [-.26,0,.26].forEach((px,i)=>{cylP(inner,px,1.78,-.42,.072,.3,10,C_RED,1,null,0,'ves');
    anchors.push({p:[px,1.78,-.42],r:.22,pt:['P12','P13','P18'][i],name:'Expansion vessel'});});
  anchors.push({p:[0,1.6,D/2],r:.3,pt:'P02',name:'Controller HMI'});
  anchors.push({p:[0,.12,.5],r:.4,pt:'P24',name:'Flood tray / leak detection'});
}

/* ---- PM8000-style panel meter: 96×96×77.5 mm PQM shown ×5 on a Cx panel stand ----
   (modelled from the vendor 3D CAD form factor + product photos — a small panel-mount
   cube: front bezel + LCD, finned body behind the panel, terminal blocks on top) */
function buildMeterAsset(){
  const an=DB().points.filter(p=>p.addrs&&p.addrs.length&&p.regType!=='Boolean'&&p.bit==null);
  const MY=1.3,S=.48;
  // stand: base + column + mounting panel (the "switchboard door" it lives in)
  boxP(solid,0,.02,0,.56,.04,.46,[10,12,17],1,C_EDGE,.25);
  boxP(solid,0,.66,-.05,.13,1.28,.16,C_FRAME,1,C_EDGE,.2);
  boxP(solid,0,MY,0,.72,.78,.035,C_PANEL,1,C_EDGE,.5);
  // meter body behind the panel — dark gray, finned sides
  boxP(shell,0,MY,-.175,S*.96,S*.96,.31,[46,51,60],1,null,0);
  [[-1],[1]].forEach(([sx])=>boxP(shell,sx*(S*.48+.008),MY,-.175,.016,S*.86,.27,[36,40,48],1,null,0));
  // terminal blocks on top (V / I / comms — top entry like the real unit)
  [[-.15,.10,.10],[0,.10,.10],[.15,.10,.10],[-.075,.22,.08],[.105,.22,.13]].forEach(([px,tw,td])=>
    boxP(solid,px,MY+S*.48+.035,-.19,tw,.07,td,[12,14,18],1,C_TEAL,.3));
  // front bezel proud of the panel + fascia decal + LCD
  boxP(shell,0,MY,.043,S+.02,S+.02,.05,[30,34,42],1,C_EDGE,.45);
  doorQuad={p:[[-S/2,MY-S/2,.07],[S/2,MY-S/2,.07],[S/2,MY+S/2,.07],[-S/2,MY+S/2,.07]],
    col:[26,29,36],a:1,edge:C_EDGE,ea:.55,decal:'door'};
  shell.push(doorQuad);
  const lw=.40,lh=.27,ly=MY+.055;
  hmiQuad={p:[[-lw/2,ly-lh/2,.073],[lw/2,ly-lh/2,.073],[lw/2,ly+lh/2,.073],[-lw/2,ly+lh/2,.073]],
    col:[210,218,222],a:1,edge:[26,158,73],ea:.8,decal:'hmi'};
  shell.push(hmiQuad);
  // x-ray internals: metering PCB + CT/VT input stage
  boxP(inner,0,MY,-.12,.4,.4,.022,[24,72,52],1,C_TEAL,.5,'pcb');
  boxP(inner,0,MY+.14,-.24,.34,.1,.12,[30,34,44],1,C_INDIGO,.4,'inp');
  boxP(inner,0,MY-.14,-.24,.3,.09,.1,[30,34,44],1,C_ORANGE,.35,'cpu');
  // anchors → real SPL points
  anchors.push({p:[0,ly,.1],r:.3,pt:(an[0]||{}).id||'P01',name:'LCD — live summary'});
  anchors.push({p:[0,MY+.3,-.19],r:.28,pt:(DB().points[0]||{}).id||'P01',name:'V/I + comms terminals'});
  anchors.push({p:[0,MY,-.15],r:.3,pt:(an[1]||an[0]||{}).id||'P01',name:'Metering engine'});
  labels3.push({p:[0,1.83,0],t:'POWER QUALITY METER',s:'PM8000 · CLASS 0.2S'});
  labels3.push({p:[0,1.66,-.24],t:'V · I · COMMS TERMINALS',s:'TOP ENTRY'});
  labels3.push({p:[.5,MY,.05],t:'96×96 PANEL MOUNT',s:'TRUE SIZE 96×96×77.5 mm — SHOWN ×5'});
  labels3.push({p:[0,.5,.14],t:'CX PANEL STAND',s:'FWT BENCH MOUNT'});
  SCENE._attach=[-.26,.09,.14];
  SCENE._scrGlow=[0,ly,.12];
}

/* ---- ABB Emax 2 E2.2-style LV air circuit breaker on a test plinth ----
   (modelled from the vendor catalogue form factor: ≈414×444 mm 3-pole block,
   light-gray fascia, Ekip Touch trip unit, O/I pushbuttons, arc chutes on top,
   rear bus terminals — shown ×2.2) */
function buildBreakerAsset(){
  const an=DB().points.filter(p=>p.addrs&&p.addrs.length&&p.regType!=='Boolean'&&p.bit==null);
  const dg=DB().points.filter(p=>p.regType==='Boolean'||p.bit!=null);
  // plinth
  boxP(solid,0,.19,0,1.06,.38,.92,C_FRAME,1,C_EDGE,.2);
  boxP(solid,0,.395,0,1.12,.03,.98,[10,12,17],1,C_EDGE,.35);
  const BY=.41,BW=.91,BH=.9,cy=BY+BH/2;
  // moulded body + arc chute fin stack on top
  boxP(shell,0,cy,-.06,BW,BH,.78,[41,46,55],1,null,0);
  for(let i=0;i<9;i++)boxP(shell,-.32+i*.08,BY+BH+.07,-.1,.02,.14,.5,[30,34,42],1,i%2?null:C_EDGE,.12);
  // rear bus terminals (2 rows × 3 poles, copper)
  [.72,1.12].forEach(yy=>[-.3,0,.3].forEach(px=>
    boxP(solid,px,yy,-.5,.17,.07,.16,[186,118,60],1,[255,180,90],.25)));
  // light-gray front fascia (escutcheon) + decal + Ekip Touch screen
  boxP(shell,0,cy,.355,.97,.96,.05,[196,201,209],1,null,0);
  doorQuad={p:[[-.45,cy-.45,.382],[.45,cy-.45,.382],[.45,cy+.45,.382],[-.45,cy+.45,.382]],
    col:[188,193,201],a:1,edge:[120,126,136],ea:.5,decal:'door'};
  shell.push(doorQuad);
  const ew=.32,eh=.24,ey=cy+.17;
  hmiQuad={p:[[-ew/2,ey-eh/2,.386],[ew/2,ey-eh/2,.386],[ew/2,ey+eh/2,.386],[-ew/2,ey+eh/2,.386]],
    col:[10,14,20],a:1,edge:[70,160,200],ea:.9,decal:'hmi'};
  shell.push(hmiQuad);
  // charging handle (proud of fascia, lower-left like the real unit)
  boxP(solid,-.27,.63,.4,.09,.22,.045,[24,27,34],1,null,0);
  // x-ray internals: 3 vertical poles + main contacts + trip electronics
  [-.24,0,.24].forEach((px,i)=>{
    cylP(inner,px,cy,-.1,.09,.72,12,C_STEELD,1,C_ORANGE,.3,'pole'+i);
    cylP(inner,px,cy+.32,-.1,.11,.1,12,C_STEEL,1,null,0);
    cylP(inner,px,cy-.32,-.1,.11,.1,12,C_STEEL,1,null,0);
    anchors.push({p:[px,cy,-.1],r:.26,pt:(an[i]||an[0]||{}).id||'P02',name:['Phase A pole','Phase B pole','Phase C pole'][i]});});
  boxP(inner,0,ey,.2,.4,.3,.14,[24,28,38],1,C_TEAL,.4,'trip');
  anchors.push({p:[0,ey,.3],r:.3,pt:(an[0]||{}).id||'P02',name:'Ekip Touch — trip unit'});
  anchors.push({p:[0,.64,.4],r:.3,pt:(dg[0]||{}).id||'P01',name:'O / I controls · spring charge'});
  labels3.push({p:[0,1.66,0],t:'AIR CIRCUIT BREAKER',s:'SACE EMAX 2 · E2.2 CLASS'});
  labels3.push({p:[0,1.5,-.4],t:'ARC CHUTES',s:'3-POLE'});
  labels3.push({p:[0,.95,-.66],t:'BUS TERMINALS',s:'REAR HORIZONTAL'});
  labels3.push({p:[.62,ey,.3],t:'EKIP TOUCH',s:'TRIP UNIT + METERING'});
  labels3.push({p:[0,.2,.56],t:'TEST PLINTH',s:'TRUE SIZE ≈414×444 mm — SHOWN ×2.2'});
  SCENE._attach=[-.5,.09,.44];
  SCENE._scrGlow=[0,ey,.45];
}

/* ---- generic interior, shaped by asset class ---- */
function buildGenericInterior(){
  const t=TPL(),cls=(t.class||'').toUpperCase();
  const analog=DB().points.filter(p=>p.addrs&&p.addrs.length&&p.regType!=='Boolean'&&p.bit==null).slice(0,6);
  const digital=DB().points.filter(p=>p.regType==='Boolean'||p.bit!=null).slice(0,6);
  const put=(pt,name,pos,r)=>anchors.push({p:pos,r:r||.26,pt,name});
  if(cls.includes('UPS')){
    // battery strings (low) + power modules (mid) + static switch (top)
    for(let r2=0;r2<2;r2++)for(let c=0;c<3;c++){
      boxP(inner,-.22+c*.22,.3+r2*.34,-.1,.18,.28,.3,[36,40,52],1,C_TEAL,.3,'bat');}
    put(analog[0]?analog[0].id:'P02','Battery string',[0,.45,-.1],.5);
    [-.18,.18].forEach((px,i)=>{boxP(inner,px,1.25,.1,.22,.5,.34,[28,33,44],1,C_INDIGO,.4,'mod');
      put((analog[i+1]||analog[0]||{}).id||'P03',['Power module A','Power module B'][i],[px,1.25,.1],.32);});
    boxP(inner,0,1.85,-.1,.5,.16,.3,C_STEELD,1,C_ORANGE,.4,'ssw');
    put((digital[0]||{}).id||'P01','Static switch / bypass',[0,1.85,-.1],.35);
    labels3.push({p:[0,.9,.7],t:'BATTERY STRINGS',s:cls});
    labels3.push({p:[0,1.55,.7],t:'POWER MODULES',s:t.identity.make});
  } else if(cls.includes('BREAKER')){
    // three vertical poles + trip unit + bus
    [-.18,0,.18].forEach((px,i)=>{cylP(inner,px,1.0,-.05,.05,1.3,12,C_STEELD,1,C_ORANGE,.35,'pole'+i);
      cylP(inner,px,1.7,-.05,.08,.12,12,C_STEEL,1,null,0);
      put((analog[i]||{}).id||'P02',['Phase A','Phase B','Phase C'][i],[px,1.2,-.05],.28);});
    boxP(inner,0,.5,.16,.42,.34,.28,[24,28,38],1,C_TEAL,.4,'trip');
    put((digital[0]||{}).id||'P02','Trip unit / status',[0,.5,.16],.34);
    labels3.push({p:[0,1.85,.5],t:'3-POLE BREAKER',s:t.identity.make+' EMAX2'});
    labels3.push({p:[0,.5,.7],t:'TRIP UNIT',s:'Ekip metering'});
  } else if(cls.includes('DX')||cls.includes('CRAH')||cls.includes('AHU')){
    // EC fans (top) + coil (mid) + compressors (low)
    [-.28,0,.28].forEach((px,i)=>{cylP(inner,px,H-.35,.1,.16,.06,16,C_STEELD,1,C_TEAL,.35,'fan'+i);
      put((analog[i]||{}).id||'P02','EC fan '+(i+1),[px,H-.35,.1],.24);});
    boxP(inner,0,1.0,.14,.9,.5,.28,[30,36,46],1,C_INDIGO,.35,'coil');
    put((analog[3]||analog[0]||{}).id||'P02','DX coil',[0,1.0,.14],.5);
    [-.24,.24].forEach((px,i)=>{cylP(inner,px,.4,-.1,.11,.34,12,C_STEELD,1,C_ORANGE,.35,'comp'+i);
      put((digital[i]||{}).id||'P02','Compressor '+(i+1),[px,.4,-.1],.28);});
    labels3.push({p:[0,H-.2,.7],t:'EC FAN ARRAY',s:cls});
    labels3.push({p:[0,1.0,.75],t:'DX COIL',s:t.identity.make});
  } else if(cls.includes('METER')){
    // compact panel meter: big display already on the door; internal PCB hint
    boxP(inner,0,H*.5,0,W*.7,H*.5,D*.5,[22,26,36],1,C_TEAL,.3,'pcb');
    put((analog[0]||{}).id||'P01','Metering module',[0,H*.5,0],.4);
    labels3.push({p:[0,H*.72,.35],t:'POWER METER',s:t.identity.make+' PM8000'});
  } else {
    // default: stacked equipment shelves
    for(let i=0;i<3;i++){boxP(inner,0,.5+i*.55,0,W*.7,.36,D*.55,[26,30,40],1,C_TEAL,.3,'shelf'+i);
      put((analog[i]||{}).id||'P01','Module '+(i+1),[0,.5+i*.55,0],.4);}
    labels3.push({p:[0,H*.5,.7],t:cls||'ASSET',s:t.identity.make});
  }
  // controller HMI anchor (all)
  anchors.push({p:[0,1.6,D/2],r:.3,pt:(DB().points[0]||{}).id||'P01',name:'Controller / HMI'});
}

/* ---------- decals (door branding + HMI) ---------- */
const doorCv=document.createElement('canvas');
function drawDoorDecal(){
  const c=CLS();
  if(c.includes('METER'))return drawMeterFascia();
  if(c.includes('BREAKER'))return drawBreakerFascia();
  doorCv.width=340;doorCv.height=820;const x=doorCv.getContext('2d');
  x.clearRect(0,0,340,820);
  const t=TPL();
  const wm=(t.identity.make||'VERTIV').toUpperCase().split('').join(' ');
  x.font='900 30px Arial';x.fillStyle='rgba(232,234,240,.95)';x.textAlign='center';
  x.save();x.translate(170,120);x.fillText(wm.length>22?wm.slice(0,22):wm,0,0);x.restore();
  x.font='600 13px Arial';x.fillStyle='rgba(150,160,175,.8)';
  const mshort=(t.identity.model||'');x.fillText((mshort.length<=16?mshort:mshort.split(' ')[0]).slice(0,20),170,150);
  if(c.includes('UPS')){
    // Modulon-style front: tri-color LED, module bays, vent field, rating badge
    x.textAlign='left';
    [['#34d399',0],['#fbbf24',1],['#ef4444',2]].forEach(([cc,i])=>{x.fillStyle=cc;
      x.globalAlpha=i?0.35:0.9;x.beginPath();x.arc(36+i*26,196,7,0,7);x.fill();x.globalAlpha=1;});
    x.font='600 11px Arial';x.fillStyle='rgba(150,160,175,.7)';x.fillText('STATUS',110,200);
    for(let b=0;b<4;b++){const by=232+b*88;
      x.strokeStyle='rgba(120,130,145,.5)';x.lineWidth=1.4;x.strokeRect(28,by,284,74);
      x.fillStyle='rgba(46,201,222,.12)';x.fillRect(28,by,284,74);
      x.fillStyle='rgba(150,160,175,.65)';x.font='600 10px monospace';
      x.fillText(b<3?('POWER MODULE '+(b+1)+' · 25 kW'):'STS / BYPASS MODULE',40,by+24);
      x.fillStyle='rgba(120,130,145,.5)';x.fillRect(288,by+28,12,20);}
    for(let r=0;r<7;r++)for(let cn=0;cn<9;cn++){
      x.fillStyle='rgba(9,11,16,.85)';x.fillRect(34+cn*32,606+r*22,20,9);}
    x.fillStyle='rgba(46,201,222,.14)';x.fillRect(28,762,140,34);
    x.strokeStyle='rgba(46,201,222,.5)';x.strokeRect(28,762,140,34);
    x.font='700 15px Arial';x.fillStyle='#7fd4ea';x.fillText('125 kW · 3Φ',44,785);
  } else if(c.includes('DX')){
    // wall-mount package DX: supply grille, dual condenser fans, intake mesh
    x.fillStyle='rgba(9,11,16,.8)';
    for(let r=0;r<7;r++)x.fillRect(30,236+r*15,280,7);
    x.strokeStyle='rgba(120,130,145,.55)';x.lineWidth=1.6;x.strokeRect(26,228,288,116);
    x.font='600 10px Arial';x.fillStyle='rgba(150,160,175,.7)';x.textAlign='left';
    x.fillText('SUPPLY AIR',30,222);
    [[105,470],[235,470]].forEach(([fx,fy])=>{
      x.strokeStyle='rgba(120,130,145,.6)';x.lineWidth=2;
      x.beginPath();x.arc(fx,fy,64,0,7);x.stroke();
      for(let rr=14;rr<=54;rr+=13){x.lineWidth=1.1;x.beginPath();x.arc(fx,fy,rr,0,7);x.stroke();}
      x.save();x.translate(fx,fy);x.fillStyle='rgba(35,40,50,.9)';
      for(let bl=0;bl<5;bl++){x.rotate(Math.PI*2/5);
        x.beginPath();x.ellipse(0,-30,9,24,.5,0,7);x.fill();}
      x.restore();
      x.fillStyle='rgba(20,23,30,1)';x.beginPath();x.arc(fx,fy,11,0,7);x.fill();});
    x.font='600 10px Arial';x.fillStyle='rgba(150,160,175,.7)';x.fillText('CONDENSER FANS',30,394);
    x.fillStyle='rgba(9,11,16,.7)';
    for(let r=0;r<5;r++)for(let cn=0;cn<12;cn++)x.fillRect(32+cn*24,584+r*24,14,14);
    x.fillText('INTAKE',30,572);
    x.strokeStyle='rgba(120,130,145,.4)';x.strokeRect(26,556,288,168);
  }
  const tag={CDU:'CDU-01',UPS:'UPS-01','LV BREAKER':'ACB-01','DX UNIT':'DX-01','POWER METER':'PM-01'}[t.class]||'AST-01';
  x.textAlign='center';
  x.fillStyle='rgba(237,28,36,.95)';x.fillRect(238,742,86,44);
  x.font='800 15px Arial';x.fillStyle='#fff';x.fillText('EQUINIX',281,760);
  x.font='600 10px monospace';x.fillText('ASSET '+tag,281,776);
  x.fillStyle='rgba(180,190,205,.8)';x.fillRect(318,300,7,26);x.fillRect(318,450,7,26);
}
/* PM8000 fascia — dark bezel: brand, LCD frame, softkeys, LEDs, home key */
function drawMeterFascia(){
  doorCv.width=512;doorCv.height=512;const x=doorCv.getContext('2d');
  x.clearRect(0,0,512,512);x.textAlign='left';
  x.font='600 19px Arial';x.fillStyle='rgba(230,234,240,.92)';
  x.fillText('PowerLogic™ PM8000',26,42);
  // LCD frame (screen itself is the live hmi quad)
  x.strokeStyle='rgba(150,158,170,.55)';x.lineWidth=3;x.strokeRect(40,52,432,292);
  // 4 soft keys under the screen
  for(let i=0;i<4;i++){const bx=58+i*104;
    x.fillStyle='rgba(14,16,22,.95)';x.fillRect(bx,376,88,44);
    x.strokeStyle='rgba(90,98,110,.5)';x.lineWidth=1.5;x.strokeRect(bx,376,88,44);
    x.fillStyle='rgba(60,66,78,.9)';x.fillRect(bx+6,382,76,6);}
  // status LEDs + alarm bell + home key
  x.fillStyle='#34d399';x.beginPath();x.arc(52,466,7,0,7);x.fill();
  x.font='600 13px Arial';x.fillStyle='rgba(150,158,170,.8)';x.fillText('⏻',66,472);
  x.fillStyle='#ef4444';x.globalAlpha=.4;x.beginPath();x.arc(112,466,7,0,7);x.fill();x.globalAlpha=1;
  x.fillText('🔔',126,472);
  x.strokeStyle='rgba(150,158,170,.7)';x.lineWidth=2.4;
  x.strokeRect(238,448,36,36);x.beginPath();
  x.moveTo(246,470);x.lineTo(256,458);x.lineTo(266,470);x.stroke();
  x.textAlign='right';x.font='700 17px Arial';x.fillStyle='rgba(230,234,240,.92)';
  x.fillText('Schneider',486,462);x.font='600 12px Arial';x.fillStyle='#3dcd58';x.fillText('Electric',486,478);
}
/* Emax 2 fascia — light escutcheon: brand, Ekip housing, handle, O/I, ratings */
function drawBreakerFascia(){
  doorCv.width=512;doorCv.height=512;const x=doorCv.getContext('2d');
  x.clearRect(0,0,512,512);x.textAlign='left';
  x.font='800 21px Arial';x.fillStyle='rgba(24,27,33,.92)';x.fillText('SACE Emax 2',26,44);
  x.font='700 14px Arial';x.fillStyle='rgba(24,27,33,.65)';x.fillText('E2.2N 2000',26,66);
  x.font='italic 900 30px Arial';x.fillStyle='#e2001a';x.textAlign='right';x.fillText('ABB',488,52);
  // Ekip Touch housing (screen = live hmi quad at its center)
  x.fillStyle='rgba(20,22,28,.96)';x.fillRect(148,78,216,190);
  x.strokeStyle='rgba(70,76,88,.8)';x.lineWidth=2;x.strokeRect(148,78,216,190);
  for(let i=0;i<4;i++){x.fillStyle='rgba(70,76,88,.9)';x.fillRect(178+i*44,244,26,10);}
  x.textAlign='left';x.font='600 11px Arial';x.fillStyle='rgba(230,234,240,.8)';x.fillText('Ekip Touch',156,96);
  // charging handle recess (3D handle sits proud of this)
  x.fillStyle='rgba(24,27,33,.28)';x.fillRect(56,286,80,160);
  x.strokeStyle='rgba(24,27,33,.4)';x.strokeRect(56,286,80,160);
  x.font='600 10px Arial';x.fillStyle='rgba(24,27,33,.6)';x.fillText('CHARGE',64,462);
  // O / I pushbuttons
  x.beginPath();x.arc(256,382,36,0,7);x.fillStyle='#c62828';x.fill();
  x.lineWidth=4;x.strokeStyle='rgba(24,27,33,.35)';x.stroke();
  x.font='800 26px Arial';x.fillStyle='#fff';x.textAlign='center';x.fillText('O',256,392);
  x.beginPath();x.arc(356,382,36,0,7);x.fillStyle='#23262e';x.fill();x.stroke();
  x.fillStyle='#fff';x.fillText('I',356,392);
  x.font='600 10px Arial';x.fillStyle='rgba(24,27,33,.6)';
  x.fillText('PUSH OFF',256,432);x.fillText('PUSH ON',356,432);
  // spring-charge + ready windows
  x.fillStyle='#f4f6f8';x.fillRect(180,448,150,28);x.strokeStyle='rgba(24,27,33,.4)';x.lineWidth=1.5;x.strokeRect(180,448,150,28);
  x.fillStyle='#a86a00';x.font='700 13px Arial';x.fillText('SPRING CHARGED',255,467);
  // rating plate
  x.textAlign='right';x.font='600 11px Arial';x.fillStyle='rgba(24,27,33,.62)';
  x.fillText('Ue 690 V · Icu 66 kA · IEC 60947-2',492,500);
  x.textAlign='left';
}
let hmiCv=document.createElement('canvas');hmiCv.width=512;hmiCv.height=300;
function drawHMIGeneric(){
  const x=hmiCv.getContext('2d');const t=TPL();
  x.fillStyle='#0a1420';x.fillRect(0,0,512,300);
  x.fillStyle='#0e2033';x.fillRect(0,0,512,54);
  x.font='700 25px Arial';x.fillStyle='#7fd4ea';x.textAlign='left';
  const hm=(t.identity.model||'ASSET');x.fillText((hm.length<=16?hm:hm.split(' ')[0]).slice(0,16),18,37);
  x.font='700 16px monospace';x.fillStyle='#9fc3d4';x.textAlign='right';x.fillText(t.class||'',494,35);x.textAlign='left';
  const anAll=DB().points.filter(p=>p.addrs&&p.addrs.length&&p.regType!=='Boolean'&&p.bit==null);
  const meaty=anAll.filter(p=>!/comm|alarm|status|fail/i.test(p.name));
  const an=meaty.length?meaty.concat(anAll.filter(p=>!meaty.includes(p))):anAll;
  const rd=id=>{try{return SIM.read(id);}catch(e){return null;}};
  const big=an[0]?rd(an[0].id):null;
  if(big&&big.txt){x.font='800 74px Arial';x.fillStyle='#e8f4fa';x.fillText(String(big.txt).slice(0,7),24,150);
    x.font='700 20px Arial';x.fillStyle='#6d8698';x.fillText(((an[0].units||'')+' '+an[0].name).toUpperCase().slice(0,26),26,182);}
  x.font='600 19px monospace';x.fillStyle='#9fc3d4';
  for(let i=0;i<3;i++){const p=an[i+1];if(!p)break;const r=rd(p.id);
    x.fillText(`${p.name.slice(0,14)}: ${r?r.txt:'—'} ${p.units||''}`,26,214+i*26);}
  const dg=DB().points.filter(p=>p.regType==='Boolean'||p.bit!=null);
  let anyAl=false;dg.forEach(p=>{const r=rd(p.id);if(r&&r.alarm)anyAl=true;});
  x.fillStyle=anyAl?'#e11d2e':'#0e2033';x.fillRect(0,262,512,38);
  x.font='700 20px Arial';x.fillStyle=anyAl?'#fff':'#3d5568';
  x.fillText(anyAl?'⚠ ALARM ACTIVE':'NO ACTIVE ALARMS',18,288);
}
/* PM8000 live LCD — white screen, green Summary band (like the real meter) */
function drawMeterScreen(){
  const x=hmiCv.getContext('2d');
  x.fillStyle='#e8edef';x.fillRect(0,0,512,300);
  const an=DB().points.filter(p=>p.addrs&&p.addrs.length&&p.regType!=='Boolean'&&p.bit==null);
  const rd=id=>{try{return SIM.read(id);}catch(e){return null;}};
  const used=new Set();
  const pick=re=>{const p=an.find(q=>re.test(q.name)&&!used.has(q.id));if(p)used.add(p.id);return p;};
  const rows=[pick(/l-?n|volt.*avg|avg.*volt/i),pick(/curr.*avg|avg.*curr|current/i),
              pick(/energy|kwh/i),pick(/power ?factor|pf/i)]
    .map(p=>{if(p)return p;const q=an.find(z=>!used.has(z.id));if(q)used.add(q.id);return q;});
  // header bar: date/time + lock/bell
  x.fillStyle='#c9d2d6';x.fillRect(0,0,512,34);
  const now=new Date();
  x.font='600 17px monospace';x.fillStyle='#2c3338';x.textAlign='left';
  x.fillText(now.toLocaleDateString('en-GB')+'  '+now.toLocaleTimeString('en-GB'),12,24);
  x.textAlign='right';x.fillText('🔒 🔔',498,24);
  // green Summary band
  x.fillStyle='#1a9e49';x.fillRect(0,34,512,34);
  x.font='700 20px Arial';x.fillStyle='#fff';x.textAlign='left';x.fillText('Summary',12,59);
  // rows: label left, big value right
  let anyAl=false;DB().points.forEach(p=>{if(p.regType==='Boolean'||p.bit!=null){const r=rd(p.id);if(r&&r.alarm)anyAl=true;}});
  rows.slice(0,4).forEach((p,i)=>{if(!p)return;const r=rd(p.id);const y=100+i*44;
    x.font='600 17px Arial';x.fillStyle='#3c454b';x.textAlign='left';
    x.fillText(p.name.slice(0,18),12,y+8);
    x.font='800 27px Arial';x.fillStyle='#11171a';x.textAlign='right';
    x.fillText((r?String(r.txt).slice(0,9):'—'),448,y+12);
    x.font='600 13px Arial';x.fillStyle='#57646b';x.fillText((p.units||'').slice(0,5),496,y+12);});
  if(anyAl){x.fillStyle='#c62828';x.fillRect(430,38,72,26);
    x.font='700 13px Arial';x.fillStyle='#fff';x.textAlign='center';x.fillText('ALARM',466,56);}
  // soft-key bar
  x.fillStyle='#c9d2d6';x.fillRect(0,272,512,28);
  x.strokeStyle='#1a9e49';x.lineWidth=2;
  [1,2,3,4].forEach(i=>{x.beginPath();x.moveTo(i*102,274);x.lineTo(i*102,298);x.stroke();});
  x.font='700 15px Arial';x.fillStyle='#1a9e49';x.textAlign='center';
  ['＋','▲','▼','◀','▦'].forEach((g,i)=>x.fillText(g,51+i*102,292));
  x.textAlign='left';
}
/* Emax 2 Ekip Touch live screen — phase currents + protection status */
function drawEkipScreen(){
  const x=hmiCv.getContext('2d');
  x.fillStyle='#0c1017';x.fillRect(0,0,512,300);
  x.fillStyle='#131a24';x.fillRect(0,0,512,44);
  x.font='700 21px Arial';x.fillStyle='#7fd4ea';x.textAlign='left';x.fillText('Ekip Touch',14,30);
  x.font='600 14px monospace';x.fillStyle='#9fc3d4';x.textAlign='right';x.fillText('E2.2N · 2000 A',498,29);
  const an=DB().points.filter(p=>p.addrs&&p.addrs.length&&p.regType!=='Boolean'&&p.bit==null);
  const rd=id=>{try{return SIM.read(id);}catch(e){return null;}};
  const cur=an.filter(p=>/current|^i ?l?[abc123]/i.test(p.name)).slice(0,3);
  const rows=cur.length?cur:an.slice(0,3);
  rows.forEach((p,i)=>{const r=rd(p.id);const y=72+i*52;
    x.font='600 15px monospace';x.fillStyle='#9fc3d4';x.textAlign='left';
    x.fillText(('L'+(i+1)+' '+p.name).slice(0,20),14,y);
    const v=r&&r.vals&&r.vals[0]!=null?r.vals[0]:0;
    const fr=Math.max(.03,Math.min(1,Math.abs(v)/((p.max||2000)||2000)));
    x.fillStyle='#16222f';x.fillRect(14,y+8,340,16);
    x.fillStyle=i===0?'#2ec9de':(i===1?'#f97316':'#9d9bff');x.fillRect(14,y+8,340*fr,16);
    x.font='700 19px monospace';x.fillStyle='#e8f4fa';x.textAlign='right';
    x.fillText((r?String(r.txt).slice(0,8):'—')+' '+(p.units||'A'),498,y+22);});
  const volt=an.find(p=>/volt/i.test(p.name));
  if(volt){const r=rd(volt.id);
    x.font='600 15px monospace';x.fillStyle='#9fc3d4';x.textAlign='left';
    x.fillText(volt.name.slice(0,22),14,242);
    x.textAlign='right';x.fillStyle='#e8f4fa';x.fillText((r?r.txt:'—')+' '+(volt.units||'V'),498,242);}
  let anyAl=false;DB().points.forEach(p=>{if(p.regType==='Boolean'||p.bit!=null){const r=rd(p.id);if(r&&r.alarm)anyAl=true;}});
  x.fillStyle=anyAl?'#e11d2e':'#10331f';x.fillRect(0,262,512,38);
  x.font='700 19px Arial';x.fillStyle=anyAl?'#fff':'#34d399';x.textAlign='left';
  x.fillText(anyAl?'⚠ PROTECTION EVENT ACTIVE':'READY — MAIN CONTACTS OK',16,287);
  x.textAlign='left';
}
function drawHMI(){
  if(!isCDU){const c=CLS();
    if(c.includes('METER'))return drawMeterScreen();
    if(c.includes('BREAKER'))return drawEkipScreen();
    return drawHMIGeneric();}
  const x=hmiCv.getContext('2d');const s=window.SIM?SIM.st:null;
  x.fillStyle='#0a1420';x.fillRect(0,0,512,300);
  if(!s){return;}
  const crit=s.alarms.critical,warn=s.alarms.nonCritical;
  x.fillStyle='#0e2033';x.fillRect(0,0,512,54);
  x.font='700 27px Arial';x.fillStyle='#7fd4ea';x.textAlign='left';x.fillText('XDU1350B',18,37);
  x.font='700 20px monospace';x.fillStyle=s.status===5?'#34d399':(s.status===8?'#f87171':'#fbbf24');
  x.textAlign='right';x.fillText((SIM.unitStates[s.status]||'').toUpperCase().slice(0,22),494,35);x.textAlign='left';
  x.font='800 82px Arial';x.fillStyle='#e8f4fa';x.fillText(s.T2.toFixed(1),24,158);
  x.font='700 24px Arial';x.fillStyle='#6d8698';x.fillText('°C SUPPLY',26,192);
  x.font='600 23px monospace';x.fillStyle='#9fc3d4';
  x.fillText(`${s.secFlow.toFixed(0)} L/min`,304,112);
  x.fillText(`${s.kW.toFixed(0)} kW`,304,148);
  x.fillText(`SP ${s.sp.toFixed(1)}°C`,304,184);
  for(let i=0;i<3;i++){const p=s.pumps[i];
    x.fillStyle='#13293d';x.fillRect(24+i*92,214,76,17);
    x.fillStyle=p.fault?'#f87171':(p.run?'#2ec9de':'#33475c');
    x.fillRect(24+i*92,214,76*(p.act/100),17);
    x.font='600 15px monospace';x.fillStyle='#7f9cb0';x.fillText(`P${i+1}`,24+i*92,250);}
  x.fillStyle=crit?'#e11d2e':(warn?'#8a6d1d':'#0e2033');x.fillRect(0,262,512,38);
  x.font='700 21px Arial';x.fillStyle=(crit||warn)?'#fff':'#3d5568';
  x.fillText(crit?'⚠ CRITICAL ALARM ACTIVE':(warn?'⚠ NON-CRITICAL ALARM':'NO ACTIVE ALARMS'),18,288);
}

/* ---------- laptop screen decal (mini WitnessONE UI) ---------- */
const lapCv=document.createElement('canvas');lapCv.width=256;lapCv.height=170;
function drawLap(){
  const x=lapCv.getContext('2d');const s=window.SIM?SIM.st:null;
  x.fillStyle='#0a0e15';x.fillRect(0,0,256,170);
  x.fillStyle='#11151f';x.fillRect(0,0,256,26);
  x.fillStyle='#f97316';x.fillRect(8,5,16,16);
  x.font='800 9px monospace';x.fillStyle='#fff';x.fillText('W1',10,16);
  x.font='800 10px Arial';x.fillStyle='#e8eaf0';x.fillText('WITNESSONE',30,17);
  x.font='600 7px Arial';x.fillStyle='#2ec9de';x.fillText('MODBUS TCP LINK',180,16);
  if(!s||!SIM.connected){x.font='600 10px monospace';x.fillStyle='#5b6472';
    x.fillText('LINK IDLE — AWAITING CONNECT',34,96);return;}
  const chart=(hist,y0,h2,col,lab,val)=>{
    x.font='600 7px Arial';x.fillStyle='#7a8494';x.fillText(lab,10,y0-4);
    x.font='700 9px monospace';x.fillStyle='#dfe5ee';x.textAlign='right';x.fillText(val,246,y0-4);x.textAlign='left';
    const d=hist.slice(-70);if(d.length<2)return;
    let mn=Math.min(...d),mx=Math.max(...d);if(mx-mn<1e-6){mn-=1;mx+=1;}
    x.beginPath();for(let i=0;i<d.length;i++){const X=10+i/(d.length-1)*236,Y=y0+h2-(d[i]-mn)/(mx-mn)*h2;
      i?x.lineTo(X,Y):x.moveTo(X,Y);}
    x.strokeStyle=col;x.lineWidth=1.6;x.stroke();};
  if(isCDU){
    chart(SIM.hist.T2,46,30,'#2ec9de','SEC SUPPLY T2',s.T2.toFixed(1)+' °C');
    chart(SIM.hist.secFlow,98,30,'#e8620c','SEC FLOW',s.secFlow.toFixed(0)+' L/min');
  } else {
    const an=DB().points.filter(p=>p.addrs&&p.addrs.length&&p.regType!=='Boolean'&&p.bit==null).slice(0,2);
    an.forEach((p,i)=>{let r=null;try{r=SIM.read(p.id);}catch(e){}
      const y0=46+i*52;x.font='600 7px Arial';x.fillStyle='#7a8494';x.fillText(p.name.slice(0,20).toUpperCase(),10,y0-4);
      x.font='700 11px monospace';x.fillStyle='#dfe5ee';x.textAlign='right';x.fillText((r?r.txt:'—')+' '+(p.units||''),246,y0-4);x.textAlign='left';
      const hh=genLapHist[p.id]=(genLapHist[p.id]||[]);if(r&&r.vals){hh.push(r.vals[0]);if(hh.length>70)hh.shift();}
      if(hh.length>1){let mn=Math.min(...hh),mx=Math.max(...hh);if(mx-mn<1e-6){mn-=1;mx+=1;}
        x.beginPath();for(let k=0;k<hh.length;k++){const X=10+k/(hh.length-1)*236,Y=y0+30-(hh[k]-mn)/(mx-mn)*30;k?x.lineTo(X,Y):x.moveTo(X,Y);}
        x.strokeStyle=i?'#e8620c':'#2ec9de';x.lineWidth=1.6;x.stroke();}});
  }
  const bad=s.faults.comms, ntags=(window.DB_TAGS||(DB().points.filter(p=>p.addrs&&p.addrs.length).length));
  x.fillStyle=bad?'rgba(248,113,113,.15)':'rgba(52,211,153,.15)';x.fillRect(10,142,122,18);
  x.fillStyle=bad?'#f87171':'#34d399';x.beginPath();x.arc(20,151,3,0,7);x.fill();
  x.font='600 8px monospace';x.fillStyle=bad?'#f87171':'#34d399';
  x.fillText(bad?'LINK BAD (24)':ntags+' TAGS GOOD (192)',28,154);
  x.fillStyle='rgba(255,255,255,.06)';x.fillRect(140,142,106,18);
  x.font='600 8px monospace';x.fillStyle='#9aa3b2';x.fillText('FC04 POLL '+(SIM.pollMs/1000)+' s',148,154);
}

/* ---------- glow sprites ---------- */
function mkGlow(color,sz=64){const c=document.createElement('canvas');c.width=c.height=sz;
  const x=c.getContext('2d');const g=x.createRadialGradient(sz/2,sz/2,1,sz/2,sz/2,sz/2);
  g.addColorStop(0,color);g.addColorStop(.4,color.replace('1)','.3)'));g.addColorStop(1,color.replace('1)','0)'));
  x.fillStyle=g;x.fillRect(0,0,sz,sz);return c;}
const G_ORANGE=mkGlow('rgba(255,170,88,1)'),G_TEAL=mkGlow('rgba(46,201,222,1)'),
      G_INDIGO=mkGlow('rgba(157,155,255,1)'),G_RED=mkGlow('rgba(255,91,91,1)'),G_WHITE=mkGlow('rgba(255,236,210,1)');

/* ---------- particles ---------- */
const dust=[];for(let i=0;i<(RMOTION?150:420);i++)dust.push({x:(Math.random()-.5)*9,y:Math.random()*3.4,z:(Math.random()-.5)*9,
  s:Math.random()*100,a:.25+Math.random()*.6});
const motes=[];let MCAP=RMOTION?280:520;
function spawnMote(stream){if(motes.length<MCAP)motes.push({t:0,sp:.5+Math.random()*.45,stream,
  ph:Math.random()*6.28,amp:.06+Math.random()*.17});}
SCENE.pollBurst=function(n=46){let i=0;const iv=setInterval(()=>{for(let k=0;k<6;k++)spawnMote(Math.random()<.6?0:1);
  if(++i>n/6)clearInterval(iv);},30);};
SCENE.writeBurst=function(){for(let i=0;i<46;i++)setTimeout(()=>spawnMote(2),i*14);};
const bz=(a,b,c,d,t)=>{const u=1-t;return a*u*u*u+3*b*u*u*t+3*c*u*t*t+d*t*t*t;};
function motePos(m,out){
  // all traffic rides the patch cable; writes (stream 2) run laptop → device
  const tt=Math.min(Math.max(m.stream===2?1-m.t:m.t,0),1);
  const p=crPoint(SCENE._cable,tt);
  const w=m.stream===2?.02:.032; // tight swirl hugging the cable
  out[0]=p[0]+Math.sin(m.t*24+m.ph)*w;
  out[1]=p[1]+.014+Math.cos(m.t*20+m.ph*1.7)*w*.8;
  out[2]=p[2]+Math.sin(m.t*18+m.ph*2.3)*w;
}
/* coolant loops via catmull-rom */
function crPoint(P,t){const n=P.length-1;const seg=Math.min(Math.floor(t*n),n-1);const u=t*n-seg;
  const p0=P[Math.max(seg-1,0)],p1=P[seg],p2=P[Math.min(seg+1,n)],p3=P[Math.min(seg+2,n)];
  const out=[0,0,0];for(let i=0;i<3;i++){const a=p1[i],b2=0.5*(p2[i]-p0[i]),
    c2=p0[i]-2.5*p1[i]+2*p2[i]-0.5*p3[i],d2=-0.5*p0[i]+1.5*p1[i]-1.5*p2[i]+0.5*p3[i];
    out[i]=a+b2*u+c2*u*u+d2*u*u*u;}return out;}
const SEC_PATH=[[.3,H+.42,-(D/2-.24)],[.3,1.6,-.3],[.26,.9,-.2],[.26,.25,-.18],[0,.2,-.1],[.2,.7,.16],[.2,1.6,.1],[.12,H+.42,-(D/2-.24)]];
const PRI_PATH=[[-.3,H+.42,-(D/2-.24)],[-.3,1.5,-.35],[-.24,.82,-.33],[-.2,.8,.1],[-.2,1.5,.16],[-.12,H+.42,-(D/2-.24)]];
const coolA=[],coolB=[];for(let i=0;i<110;i++){coolA.push({t:i/110});coolB.push({t:i/110});}
const drips=[];for(let i=0;i<44;i++)drips.push({x:0,y:-1,z:0,v:.5+Math.random()*.4});
/* assembly cloud */
const ASMN=3400;let asmS=null,asmT2=null,asmStag=null;
function prepAssembly(){
  asmS=new Float32Array(ASMN*3);asmT2=new Float32Array(ASMN*3);asmStag=new Float32Array(ASMN);
  const faces=shell.concat(solid.slice(0,40));
  for(let i=0;i<ASMN;i++){
    const fc=faces[(Math.random()*faces.length)|0].p;
    const a2=fc[0],b2=fc[1],c2=fc[fc.length-1];
    const u=Math.random(),v=Math.random();
    for(let k=0;k<3;k++)asmT2[i*3+k]=a2[k]+(b2[k]-a2[k])*u+(c2[k]-a2[k])*v;
    const th=Math.random()*6.283,ph=Math.acos(2*Math.random()-1),rr=3.4+Math.random()*3.2;
    asmS[i*3]=Math.sin(ph)*Math.cos(th)*rr;asmS[i*3+1]=Math.abs(Math.cos(ph))*rr*.7+.15;asmS[i*3+2]=Math.sin(ph)*Math.sin(th)*rr;
    asmStag[i]=Math.random()*.35;}
}
SCENE.assemble=function(cb){assembling=true;asmT=0;asmCb=cb;};

/* ---------- draw helpers ---------- */
const rgba=(c,a)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const s0=[0,0,0],s1=[0,0,0],s2=[0,0,0],s3=[0,0,0],tmp=[0,0,0];
let drawList=[];
function pushFace(fc,alphaMul){
  const n=fc.p.length;const scr=[];let zsum=0;
  for(let i=0;i<n;i++){const s=proj(fc.p[i],[0,0,0]);if(!s)return;scr.push(s);zsum+=s[2];}
  const z=zsum/n;
  // backface cull (skip for translucent shell in xray to show inner walls)
  const nr=cross(sub(fc.p[1],fc.p[0]),sub(fc.p[2],fc.p[0]));
  const facing=dot(nr,sub(eye,fc.p[0]));
  if(facing<=0&&fc.p.length===4)return; // cull quads only; n-gon caps always draw
  const lam=Math.abs(dot(nrm(nr),LIGHT));
  const sh=.42+.58*lam;
  drawList.push({z,fn(){
    const a=(fc.a??1)*alphaMul*Math.max(.25,fog(z));
    if(a<=0.004)return;
    ctx.beginPath();ctx.moveTo(scr[0][0],scr[0][1]);
    for(let i=1;i<scr.length;i++)ctx.lineTo(scr[i][0],scr[i][1]);
    ctx.closePath();
    ctx.fillStyle=rgba([fc.col[0]*sh,fc.col[1]*sh,fc.col[2]*sh],a);
    ctx.fill();
    if(fc.edge){ctx.strokeStyle=rgba(fc.edge,(fc.ea??.5)*alphaMul*fog(z));ctx.lineWidth=1.1;ctx.stroke();}
    if(fc.decal==='door')decalQuad(scr,doorCv,a);
    if(fc.decal==='hmi')decalQuad(scr,hmiCv,Math.min(1,a*1.6));
    if(fc.decal==='lap')decalQuad(scr,lapCv,Math.min(1,a*1.55));
  }});
}
function decalQuad(scr,img,a){
  // affine map unit image onto quad (p0=BL,p1=BR,p3=TL in our winding p:[bl,br,tr,tl])
  const p0=scr[3],p1=scr[2],p3=scr[0]; // top-left, top-right, bottom-left (img y-down)
  ctx.save();ctx.globalAlpha=Math.min(1,a);
  ctx.setTransform((p1[0]-p0[0])/img.width,(p1[1]-p0[1])/img.width,
                   (p3[0]-p0[0])/img.height,(p3[1]-p0[1])/img.height,p0[0],p0[1]);
  ctx.drawImage(img,0,0);ctx.restore();
  ctx.setTransform(1,0,0,1,0,0);
}
function glowAt(v,img,size,alpha){const s=proj(v,tmp);if(!s)return;
  const k=size*f/s[2];ctx.globalAlpha=alpha*fog(s[2]);
  ctx.drawImage(img,s[0]-k/2,s[1]-k/2,k,k);ctx.globalAlpha=1;}
function line3(pts,color,alphaBase,width){
  ctx.beginPath();let started=false;
  for(const p of pts){const s=proj(p,tmp);if(!s){started=false;continue;}
    started?ctx.lineTo(s[0],s[1]):(ctx.moveTo(s[0],s[1]),started=true);}
  ctx.strokeStyle=color+alphaBase+')';ctx.lineWidth=width;ctx.stroke();}

/* ---------- input ---------- */
function setupInput(){
  let drag=false,px=0,py=0,moved=0;
  cv.addEventListener('pointerdown',e=>{drag=true;moved=0;px=e.clientX;py=e.clientY;orbit.auto=false;});
  addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-px,dy=e.clientY-py;
    px=e.clientX;py=e.clientY;moved+=Math.abs(dx)+Math.abs(dy);
    orbit.vaz-=dx*.0031;orbit.vel+=dy*.0026;});
  addEventListener('pointerup',e=>{if(drag&&moved<6&&mode==='live')pick(e);drag=false;});
  cv.addEventListener('wheel',e=>{e.preventDefault();
    orbit.r=Math.min(11,Math.max(2.5,orbit.r*(1+e.deltaY*.0011)));},{passive:false});
}
function pick(e){
  let best=null,bd=1e9;
  for(const a of anchors){const s=proj(a.p,tmp);if(!s)continue;
    const rr=a.r*f/s[2];const d=Math.hypot(e.clientX-s[0],e.clientY-s[1]);
    if(d<rr&&s[2]<bd){bd=s[2];best=a;}}
  if(best&&window.UI){UI.selectPoint(best.pt);toast(`◎ ${best.name} — inspecting ${best.pt}`,'',1800);}
}

/* ---------- main loop ---------- */
function frame(){
  requestAnimationFrame(frame);
  if(frame._lowq){frame._flip=!frame._flip;if(frame._flip)return;}  // 30 fps is plenty on software GL
  const now=performance.now(),t=(now-t0)/1000,dt=Math.min(t-tPrev,.05)||.016;tPrev=t;
  // adaptive quality — VM / software-rendered sessions degrade particles, not the twin
  frame._ema=(frame._ema||.016)*.95+dt*.05;
  if(frame._ema>.05&&!frame._lowq){frame._lowq=true;
    dust.length=Math.min(dust.length,120);MCAP=Math.min(MCAP,220);}
  const S=window.SIM?SIM.st:null;
  // orbit
  if(orbit.auto&&mode==='live')orbit.vaz+=.00023;
  if(mode==='boot')orbit.az+=dt*.05;
  orbit.az+=orbit.vaz;orbit.el=Math.max(.08,Math.min(1.2,orbit.el+orbit.vel));
  orbit.vaz*=.9;orbit.vel*=.9;
  camUpdate();
  // bg
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(frame._lowq){ctx.fillStyle='#0a0d12';ctx.fillRect(0,0,CW,CH);}
  else{const bg=ctx.createRadialGradient(CW/2,CH*.42,80,CW/2,CH*.42,Math.max(CW,CH)*.75);
  bg.addColorStop(0,'#0d1017');bg.addColorStop(.55,'#090b10');bg.addColorStop(1,'#06070b');
  ctx.fillStyle=bg;ctx.fillRect(0,0,CW,CH);}
  // ground
  for(const g of groundL)line3(g.pts,g.c,g.a,1);
  // shadow under cabinet
  {const s=proj([0,0.01,0],tmp);if(s){const k=1.15*f/s[2];
    const gr=ctx.createRadialGradient(s[0],s[1],2,s[0],s[1],k);
    gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(s[0],s[1],k,k*.42,0,0,7);ctx.fill();}}
  // x-ray fade
  xrayT+=((xray?1:0)-xrayT)*Math.min(1,dt*6);
  // build draw list
  drawList=[];
  const shellMul=shellA*(1-xrayT*.93);
  const solidMul=shellA;
  if(shellA>0.01){
    for(const fc2 of inner)pushFace(fc2,solidMul);
    for(const fc2 of solid)pushFace(fc2,solidMul);
    for(const fc2 of shell)pushFace(fc2,fc2===hmiQuad?solidMul:shellMul);
  }
  for(const fc2 of pylonF)pushFace(fc2,1);
  drawList.sort((a,b)=>b.z-a.z);
  for(const d of drawList)d.fn();
  // dynamic overlays on solids (CDU-specific machine cues)
  if(S&&shellA>0.5&&isCDU){
    // impeller glow rings
    [-.26,0,.26].forEach((px,i)=>{const p=S.pumps[i];
      const s=proj([px,.2,-.18],tmp);if(!s)return;const k=.1*f/s[2];
      ctx.save();ctx.globalCompositeOperation='lighter';
      const ringVis=.25+.75*xrayT;
      ctx.strokeStyle=p.fault?`rgba(255,91,91,${(.5+.4*Math.sin(t*8))})`:`rgba(46,201,222,${(.15+p.act/100*.65)*ringVis})`;
      ctx.lineWidth=Math.max(1.5,k*.16);
      ctx.setLineDash([k*.5,k*.32]);ctx.lineDashOffset=-t*p.act*.12*k;
      ctx.beginPath();ctx.ellipse(s[0],s[1],k,k*.38,0,0,7);ctx.stroke();ctx.restore();
      if(p.fault)glowAt([px,.45,-.18],G_RED,.7,.5+.3*Math.sin(t*8));
      else if(p.act>3)glowAt([px,.45,-.18],G_TEAL,.55,p.act/100*.4);});
    // valve knobs spin markers
    const vp=S.valvePos[0]/100*Math.PI*1.5;
    [[-.24,.9,-.38],[-.24,.9,-.28]].forEach(vb=>{
      const c2=[vb[0]+Math.cos(vp)*.045,vb[1]+.03,vb[2]+Math.sin(vp)*.045];
      line3([vb,c2],'rgba(255,210,160,',.9*shellA,2);});
    // edge strip (critical → blink red)
    const crit=S.alarms.critical;
    const stripCol=crit?(Math.sin(t*9)>0?'rgba(255,60,60,':'rgba(90,20,20,'):'rgba(249,115,22,';
    line3([[-(W/2-.085),.3,D/2+.002],[-(W/2-.085),H-.25,D/2+.002]],stripCol,.9*shellMul+.05,2.5);
    glowAt([0,1.6,D/2+.06],G_WHITE,.5,.28+.08*Math.sin(t*2.1));
  }
  // non-cabinet assets (meter / breaker): screen glow only
  if(S&&shellA>0.5&&!hasCabinet&&SCENE._scrGlow)
    glowAt(SCENE._scrGlow,G_TEAL,.45,.26+.08*Math.sin(t*2.1));
  // generic cabinet assets: gentle door-screen glow + alarm-aware edge strip
  if(S&&shellA>0.5&&!isCDU&&hasCabinet){
    let anyAl=false;try{DB().points.forEach(p=>{if(p.regType==='Boolean'||p.bit!=null){const r=SIM.read(p.id);if(r&&r.alarm)anyAl=true;}});}catch(e){}
    const stripCol=anyAl?(Math.sin(t*9)>0?'rgba(255,60,60,':'rgba(90,20,20,'):'rgba(249,115,22,';
    line3([[-(W/2-.085),.3,D/2+.002],[-(W/2-.085),H-.25,D/2+.002]],stripCol,.9*shellMul+.05,2.5);
    glowAt([0,1.6,D/2+.06],G_TEAL,.5,.26+.08*Math.sin(t*2.1));
  }
  // pipe stub glows (CDU)
  if(shellA>0.5)for(const [px,py2,pz,cc] of pipeStubs)
    glowAt([px,py2,pz],cc===C_TEAL?G_TEAL:G_INDIGO,.3,.35);
  // Cx laptop glow + patch cable with data pulses
  glowAt(SCENE._pyl,G_ORANGE,.5,.36+.1*Math.sin(t*3.2));
  glowAt([SCENE._pyl[0],.06,SCENE._pyl[2]],G_TEAL,.5,.14);
  if(SCENE._cable){
    const cp=[];for(let i=0;i<=36;i++)cp.push(crPoint(SCENE._cable,i/36));
    line3(cp,'rgba(46,201,222,',.3,1.6);
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<5;i++){const tt=(t*.16+i/5)%1;const p=crPoint(SCENE._cable,tt);
      const s=proj(p,tmp);if(!s)continue;const k=Math.max(2,.09*f/s[2]);
      ctx.globalAlpha=.65*fog(s[2]);ctx.drawImage(G_TEAL,s[0]-k/2,s[1]-k/2,k,k);}
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  }
  // ---- particles (additive) ----
  ctx.globalCompositeOperation='lighter';
  // ambient dust
  for(const d2 of dust){
    d2.x+=Math.sin(t*.22+d2.s)*.0016+.0011;d2.y+=Math.cos(t*.17+d2.s*1.3)*.0009;d2.z+=Math.sin(t*.19+d2.s*.7)*.0014;
    if(d2.x>5)d2.x=-5;if(d2.y>3.6)d2.y=.05;if(d2.y<0)d2.y=3.4;if(d2.z>5)d2.z=-5;
    const s=proj([d2.x,d2.y,d2.z],tmp);if(!s)continue;
    const k=Math.max(1.4,.05*f/s[2]);
    ctx.globalAlpha=d2.a*.4*fog(s[2]);ctx.drawImage(G_ORANGE,s[0]-k/2,s[1]-k/2,k,k);}
  ctx.globalAlpha=1;
  // data motes
  for(let i=motes.length-1;i>=0;i--){const m=motes[i];m.t+=dt*m.sp*.55;
    if(m.t>=1){motes.splice(i,1);continue;}} // all reads terminate at the laptop
  for(const m of motes){motePos(m,tmp);const s=proj(tmp,s0);if(!s)continue;
    const a=Math.sin(Math.min(m.t,1)*Math.PI);
    const k=Math.max(2,( m.stream===2?.16:.12)*f/s[2]);
    ctx.globalAlpha=a*.85*fog(s[2]);
    ctx.drawImage(m.stream===2?G_INDIGO:G_ORANGE,s[0]-k/2,s[1]-k/2,k,k);}
  ctx.globalAlpha=1;
  // coolant loops (CDU only — other assets have no liquid circuits)
  if(S&&shellA>0.3&&isCDU){
    const visA=(xrayT*.8+.14);
    [[coolA,SEC_PATH,S.secFlow/1725,G_TEAL],[coolB,PRI_PATH,S.priFlow/1725,G_INDIGO]].forEach(([arr,path,fl,img])=>{
      for(const c2 of arr){c2.t=(c2.t+dt*(.02+fl*.12))%1;const p=crPoint(path,c2.t);
        const s=proj(p,tmp);if(!s)continue;const k=Math.max(1.6,.09*f/s[2]);
        ctx.globalAlpha=visA*(fl>.02?.8:.15)*fog(s[2]);
        ctx.drawImage(img,s[0]-k/2,s[1]-k/2,k,k);}});
    ctx.globalAlpha=1;}
  // leak drips
  if(S){const on=S.faults.leak;
    if(on)for(const d2 of drips){d2.y-=dt*d2.v;
      if(d2.y<.02){d2.x=(Math.random()-.5)*.7;d2.y=.25+Math.random()*.35;d2.z=(Math.random()-.5)*.9;}
      const s=proj([d2.x,d2.y,d2.z],tmp);if(!s)continue;const k=Math.max(2,.1*f/s[2]);
      ctx.globalAlpha=.8;ctx.drawImage(G_RED,s[0]-k/2,s[1]-k/2,k,k);}
    if(on)glowAt([0,.28,.55],G_RED,1.6,.35+.25*Math.sin(t*7));
    ctx.globalAlpha=1;}
  // assembly cloud
  if(assembling){asmT+=dt/(RMOTION?1.2:3.0);
    const ease=u=>u<0?0:u>1?1:u*u*(3-2*u);
    const fade=asmT<.8?1:Math.max(0,1-(asmT-.8)/.25);
    for(let i=0;i<ASMN;i++){const u=ease((asmT-asmStag[i])/.65);
      const wob=(1-u)*.3;
      tmp[0]=asmS[i*3]+(asmT2[i*3]-asmS[i*3])*u+Math.sin(t*3+i)*wob*.2;
      tmp[1]=asmS[i*3+1]+(asmT2[i*3+1]-asmS[i*3+1])*u+Math.cos(t*2.6+i*1.7)*wob*.16;
      tmp[2]=asmS[i*3+2]+(asmT2[i*3+2]-asmS[i*3+2])*u+Math.sin(t*2.2+i*.9)*wob*.2;
      const s=proj(tmp,s0);if(!s)continue;const k=Math.max(1.6,.1*f/s[2]);
      ctx.globalAlpha=.8*fade*fog(s[2]);
      ctx.drawImage(G_ORANGE,s[0]-k/2,s[1]-k/2,k,k);}
    ctx.globalAlpha=1;
    shellA=Math.max(shellA,Math.min(1,Math.max(0,(asmT-.55)/.45)));
    if(asmT>=1.05){assembling=false;shellA=1;if(asmCb){const cb=asmCb;asmCb=null;cb();}}}
  ctx.globalCompositeOperation='source-over';
  // 3D labels
  const labA=xrayT*shellA;
  if(labA>0.02)for(const L of labels3){const s=proj(L.p,tmp);if(!s)continue;
    drawLabel(s,L.t,L.s,labA);}
  {const L=SCENE._pylLabel;const s=proj(L.p,tmp);if(s)drawLabel(s,L.t,L.s,.95);}
  // HMI refresh ~1 Hz
  if(!frame._hmiAcc)frame._hmiAcc=0;frame._hmiAcc+=dt;
  if(frame._hmiAcc>1){frame._hmiAcc=0;drawHMI();drawLap();}
}
function drawLabel(s,txt,sub,a){
  ctx.font='800 12px Inter,Arial';ctx.textAlign='center';
  ctx.fillStyle=`rgba(255,213,166,${.95*a})`;
  ctx.shadowColor='rgba(249,115,22,.8)';ctx.shadowBlur=10*a;
  ctx.fillText(txt,s[0],s[1]);ctx.shadowBlur=0;
  if(sub){ctx.font='600 9px Inter,Arial';ctx.fillStyle=`rgba(200,208,220,${.75*a})`;
    ctx.fillText(sub,s[0],s[1]+13);}
  ctx.textAlign='left';
}

/* ---------- API ---------- */
SCENE.toggleXray=function(){xray=!xray;return xray;};
SCENE.setAuto=a=>{orbit.auto=a;};
SCENE.resetView=function(){orbit.r=R0;orbit.az=-.62;orbit.el=.34;};
SCENE.heroCam=function(){orbit.r=R0;orbit.az=-.62;orbit.el=.34;orbit.auto=!RMOTION;};
SCENE.setMode=m=>{mode=m;};
SCENE.rebuild=function(){
  // clear all geometry + anchors and rebuild for the current active template
  [shell,solid,inner,pylonF,groundL,labels3,pipeStubs,anchors].forEach(a=>a.length=0);
  shellA=0;assembling=false;asmT=0;
  applyDims();build();drawDoorDecal();drawHMI();drawLap();prepAssembly();
};
SCENE.init=function(){
  cv=document.getElementById('gl');ctx=cv.getContext('2d');
  const rs=()=>{CW=cv.width=innerWidth;CH=cv.height=innerHeight;};
  rs();addEventListener('resize',rs);
  applyDims();build();drawDoorDecal();drawHMI();drawLap();prepAssembly();setupInput();
  requestAnimationFrame(frame);
};
})();
</script>
