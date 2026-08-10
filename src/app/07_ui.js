<script>
/* ============ WitnessONE dashboard UI ============ MG */
(function(){
const UI = window.UI = {};
const $=id=>document.getElementById(id);
/* SEC-2: HTML-escape registry/pointslist-derived strings before they reach innerHTML */
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
/* UX-3: make a mouse-only element keyboard-operable (focusable, labelled, Enter/Space, visible focus) */
function a11yClick(el,fn,label){el.tabIndex=0;el.setAttribute('role','button');
  if(label)el.setAttribute('aria-label',label);
  el.onclick=fn;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}};
  /* 01_head.html's :focus-visible ring only matches button/select/input, so ring these inline */
  el.addEventListener('focus',()=>{let fv=true;try{fv=el.matches(':focus-visible');}catch(_){}
    if(fv){el.style.outline='2px solid var(--acc)';el.style.outlineOffset='2px';}});
  el.addEventListener('blur',()=>{el.style.outline='';el.style.outlineOffset='';});}
const DB=window.SPL_DB; const PTS=DB.points; const byId={}; PTS.forEach(p=>byId[p.id]=p);
const C={teal:'#2ec9de',tealD:'#0894a8',orange:'#e8620c',orangeH:'#ff9a4d',indigo:'#7e7bf2',
  txt:'#e8eaf0',txt2:'#9aa3b2',txt3:'#5b6472',good:'#34d399',warn:'#fbbf24',crit:'#f87171'};
let selected=null, lastReads={};

window.toast=function(msg,cls='',ms=3400){const t=document.createElement('div');
  t.className='toast '+cls;t.innerHTML=msg;$('toasts').appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .4s';setTimeout(()=>t.remove(),400)},ms);};

/* ---------- event log ---------- */
const evq=[];
function ts(){const d=new Date();return d.toTimeString().slice(0,8)+'.'+String(d.getMilliseconds()).padStart(3,'0');}
UI.log=function(msg,cls=''){const el=$('evlog');const line=document.createElement('div');
  line.innerHTML=`<span class="t">${ts()}</span>  <span class="${cls}">${msg}</span>`;
  el.appendChild(line);while(el.children.length>220)el.firstChild.remove();
  el.scrollTop=el.scrollHeight;};

/* ---------- sparklines ---------- */
function spark(cv,data,color,{fill=true}={}){
  const dpr=Math.min(devicePixelRatio,2);const w=cv.clientWidth||76,h=cv.clientHeight||30;
  if(cv.width!==w*dpr){cv.width=w*dpr;cv.height=h*dpr;}
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  if(!data||data.length<2)return;
  const n=data.length;let mn=Infinity,mx=-Infinity;
  for(const v of data){if(v<mn)mn=v;if(v>mx)mx=v;}
  if(mx-mn<1e-6){mn-=.5;mx+=.5;}const pad=(mx-mn)*.15;mn-=pad;mx+=pad;
  const px=i=>i/(n-1)*w, py=v=>h-2-(v-mn)/(mx-mn)*(h-4);
  if(fill){x.beginPath();x.moveTo(0,h);for(let i=0;i<n;i++)x.lineTo(px(i),py(data[i]));x.lineTo(w,h);x.closePath();
    const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,color+'33');g.addColorStop(1,color+'00');x.fillStyle=g;x.fill();}
  x.beginPath();for(let i=0;i<n;i++)i?x.lineTo(px(i),py(data[i])):x.moveTo(px(i),py(data[i]));
  x.strokeStyle=color;x.lineWidth=2;x.lineJoin='round';x.stroke();
}

/* ---------- tiles ---------- */
const TILES=[
 {g:'Thermal — secondary loop (TCS)',sw:C.teal},
 {id:'t2',pt:'P08',lab:'Sec Supply T2',unit:'°C',dec:1,hk:'T2',col:C.teal,
   get:s=>s.T2,sub:s=>`SP ${s.sp.toFixed(1)} · dew ${s.dew.toFixed(1)}`,al:s=>s.alarms.t2hi||s.alarms.t2lo},
 {id:'t4',pt:'P09',lab:'Sec Return T4',unit:'°C',dec:1,hk:'T4',col:C.teal,get:s=>s.T4,sub:s=>`ΔT ${(s.T4-s.T2).toFixed(1)} K`},
 {g:'Thermal — primary loop (FWS)',sw:C.indigo},
 {id:'t1',pt:'P06',lab:'Pri Supply T1',unit:'°C',dec:1,col:C.indigo,get:s=>s.T1,sub:s=>`approach ${(s.T2-s.T1).toFixed(1)} K`},
 {id:'t5',pt:'P07',lab:'Pri Return T5',unit:'°C',dec:1,col:C.indigo,get:s=>s.T5},
 {g:'Hydraulics',sw:C.teal},
 {id:'sf',pt:'P15',lab:'Sec Flow',unit:'L/min',dec:0,hk:'secFlow',col:C.teal,get:s=>s.secFlow,
   sub:s=>`pri ${s.priFlow.toFixed(0)} L/min`,al:s=>s.alarms.lowflow},
 {id:'dp',pt:'P18',lab:'Pump ΔP (PS2−PS1)',unit:'bar',dec:2,hk:'PS2',col:C.teal,get:s=>s.PS2-s.PS1,
   sub:s=>`PS2 ${s.PS2.toFixed(2)} · PS1 ${s.PS1.toFixed(2)}`},
 {id:'fdp',pt:'P17',lab:'Sec Filter ΔP (a/b/c)',unit:'bar',dec:2,col:C.teal,get:s=>s.PS5[0],
   sub:s=>`${s.PS5.map(v=>v.toFixed(2)).join(' / ')}`},
 {g:'Machine',sw:C.orange},
 {id:'pmp',pt:'P03',lab:'Pumps P1·P2·P3',unit:'%',dec:0,hk:'pump',col:C.orange,get:s=>Math.max(...s.pumps.map(p=>p.act)),
   sub:s=>s.pumps.map((p,i)=>`P${i+1} ${p.fault?'FLT':p.act.toFixed(0)+'%'}`).join(' · '),al:s=>s.pumps.some(p=>p.fault)},
 {id:'vlv',pt:'P05',lab:'Primary Valves CV1·CV2',unit:'%',dec:0,hk:'valve',col:C.indigo,get:s=>s.valvePos[0],
   sub:s=>`cmd ${s.valveCmd[0]} % · stroke 40 s`},
 {id:'kw',pt:'P26',lab:'Cooling Capacity',unit:'kW',dec:0,hk:'kW',col:C.orange,get:s=>s.kW,
   sub:s=>`load ${s.load.toFixed(0)} kW · DCOSC calc`},
 {id:'st',pt:'P02',lab:'Unit Status (30001)',unit:'',dec:0,col:C.orange,get:s=>s.status,
   sub:s=>(SIM.unitStates[s.status]||'?').toUpperCase(),al:s=>s.status===8},
];
/* generic tiles for any non-CDU template */
let GEN_TILES=[], genHist={};
function genColorFor(i){return [C.teal,C.orange,C.indigo][i%3];}
function buildGenericTiles(){
  const host=$('tiles');host.innerHTML='';GEN_TILES=[];genHist={};
  const pts=DB.points.filter(p=>p.addrs&&p.addrs.length);
  const analog=pts.filter(p=>p.regType!=='Boolean'&&p.bit==null&&!(p.stateTable&&p.min==null));
  const digital=pts.filter(p=>p.regType==='Boolean'||p.bit!=null);
  const pick=analog.slice(0,10);
  const grp=(t,sw)=>{const g=document.createElement('div');g.className='tgroup';
    g.innerHTML=`<span class="sw" style="background:${sw}"></span>${t}`;host.appendChild(g);};
  grp(`Live analog — ${(t=>t.identity.make===t.class?t.class:t.identity.make+' '+t.class)(W1_ACTIVE_TEMPLATE)}`,C.teal);
  pick.forEach((p,i)=>{const col=genColorFor(i);
    GEN_TILES.push({id:p.id,col,unit:p.units||''});genHist[p.id]=[];
    const d=document.createElement('div');d.className='tile';d.id='tile_'+p.id;
    d.innerHTML=`<div class="tl"><span class="name">${esc(p.name)}</span></div>
      <div class="val num"><span id="tv_${p.id}">—</span><small>${esc(p.units||'')}</small></div>
      <div class="sub"><span id="tsub_${p.id}"></span></div>
      <canvas id="tsp_${p.id}" width="76" height="30" style="width:76px;height:30px"></canvas>`;
    a11yClick(d,()=>UI.selectPoint(p.id),'Select point '+p.name);host.appendChild(d);});
  if(digital.length){grp(`Status & alarms — ${digital.length} points`,C.orange);
    digital.slice(0,6).forEach(p=>{GEN_TILES.push({id:p.id,col:C.orange,unit:'',digital:true});
      const d=document.createElement('div');d.className='tile';d.id='tile_'+p.id;
      d.innerHTML=`<div class="tl"><span class="name">${esc(p.name)}</span></div>
        <div class="val num" style="font-size:14px"><span id="tv_${p.id}">—</span></div>
        <div class="sub"><span id="tsub_${p.id}">${esc(p.addrRaw||'')}</span></div>`;
      a11yClick(d,()=>UI.selectPoint(p.id),'Select point '+p.name);host.appendChild(d);});}
}
function updGenericTiles(){
  GEN_TILES.forEach(t=>{const r=SIM.read(t.id);const el=$('tile_'+t.id);
    $('tv_'+t.id).textContent=r.txt;
    if(t.digital){el&&el.classList.toggle('alarmed',!!r.alarm);return;}
    if(r.vals){genHist[t.id].push(r.vals[0]);if(genHist[t.id].length>80)genHist[t.id].shift();
      spark($('tsp_'+t.id),genHist[t.id],t.col);}});
}
function buildTiles(){
  if(!SIM.isCDU){buildGenericTiles();return;}
  const host=$('tiles');host.innerHTML='';
  TILES.forEach(t=>{
    if(t.g){const g=document.createElement('div');g.className='tgroup';
      g.innerHTML=`<span class="sw" style="background:${t.sw}"></span>${t.g}`;host.appendChild(g);return;}
    const d=document.createElement('div');d.className='tile';d.id='tile_'+t.id;
    d.innerHTML=`<div class="tl"><span class="name">${t.lab}</span></div>
      <div class="val num"><span id="tv_${t.id}">—</span><small>${t.unit}</small></div>
      <div class="sub"><span id="tsub_${t.id}"></span></div>
      ${t.hk?`<canvas id="tsp_${t.id}" width="76" height="30" style="width:76px;height:30px"></canvas>`:''}`;
    a11yClick(d,()=>UI.selectPoint(t.pt),'Select point '+t.lab);
    host.appendChild(d);});
}
function updTiles(s){
  if(!SIM.isCDU){updGenericTiles();return;}
  TILES.forEach(t=>{if(t.g)return;
    $('tv_'+t.id).textContent=t.get(s).toFixed(t.dec);
    if(t.sub)$('tsub_'+t.id).textContent=t.sub(s);
    const el=$('tile_'+t.id);el.classList.toggle('alarmed',!!(t.al&&t.al(s)));
    if(t.hk)spark($('tsp_'+t.id),SIM.hist[t.hk].slice(-80),t.col);});
}

/* ---------- trend chart ---------- */
let trendHover=null;
/* ---------- trends: multi-series, per-point history from session start, selectable time frame ---------- */
const HIST_CAP=7200;                                          // ~2 h at 1 s/sample, rolls oldest out
const TREND_COLORS=['#2ec9de','#e8620c','#7e7bf2','#3fb950','#e3b341','#ff6b9d','#4dd0e1','#c084fc'];
UI.hist={};                                                   // {pointId:{t:[ms],v:[eng value]}}
UI.trendState={series:[],tf:0,t0:null};                       // tf seconds (0 = all since session start)
function trendColorFor(id){const i=UI.trendState.series.indexOf(id);return TREND_COLORS[(i<0?0:i)%TREND_COLORS.length];}
function clockHMS(t){const d=new Date(t),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());}
function trendShort(p){return (p.name||p.id).replace(/Temperature/ig,'Temp').replace(/Secondary/ig,'Sec').replace(/Primary/ig,'Pri');}
function captureHist(reads){
  const now=Date.now();if(UI.trendState.t0==null)UI.trendState.t0=now;
  reads.forEach(r=>{if(!r.vals||!r.vals.length||!r.q||r.q.code!==192)return;
    const v=+r.vals[0];if(!isFinite(v))return;
    const h=UI.hist[r.id]||(UI.hist[r.id]={t:[],v:[]});
    h.t.push(now);h.v.push(v);if(h.t.length>HIST_CAP){h.t.shift();h.v.shift();}});
}
function defaultTrendSeries(){
  const pref=['P08','P09','P04'].filter(id=>byId[id]);        // CDU supply / return / setpoint
  if(pref.length>=2)return pref;
  return DB.points.filter(p=>p.addrs&&p.addrs.length&&p.bit==null&&!(p.regType||'').toLowerCase().includes('bool')).slice(0,3).map(p=>p.id);
}
UI.initTrend=function(){if(!UI.trendState.series.length)UI.trendState.series=defaultTrendSeries();
  rebuildTrendLegend();rebuildAddSeries();};
UI.addTrend=function(id){const S=UI.trendState;if(!byId[id]||S.series.includes(id))return;
  if(S.series.length>=8){toast('A trend holds up to 8 series — remove one first','warn');return;}
  S.series.push(id);rebuildTrendLegend();rebuildAddSeries();drawTrend();if(selected===id)fillDetail(id);};
UI.removeTrend=function(id){const S=UI.trendState;S.series=S.series.filter(x=>x!==id);
  rebuildTrendLegend();rebuildAddSeries();drawTrend();if(selected===id)fillDetail(id);};
UI.toggleTrend=function(id){UI.trendState.series.includes(id)?UI.removeTrend(id):UI.addTrend(id);};
UI.setTrendTf=function(sec){UI.trendState.tf=sec;
  document.querySelectorAll('#tfSeg .tfb').forEach(b=>b.classList.toggle('on',+b.dataset.tf===sec));drawTrend();};
function rebuildTrendLegend(){
  const host=$('trendLegend');if(!host)return;host.innerHTML='';
  if(!UI.trendState.series.length){host.innerHTML='<span class="k" style="font-size:10px">No series — pick a point below, or “＋ Add to trend” from a point’s detail.</span>';return;}
  UI.trendState.series.forEach(id=>{const p=byId[id];if(!p)return;
    const el=document.createElement('span');el.className='li';
    el.innerHTML=`<span class="sw" style="background:${trendColorFor(id)}"></span>${esc(trendShort(p))}${p.units?` <span class="k">${esc(p.units)}</span>`:''} <button class="lx" title="Remove ${esc(p.id)}" aria-label="Remove ${esc(p.id)} from trend">×</button>`;
    el.querySelector('.lx').onclick=()=>UI.removeTrend(id);host.appendChild(el);});
}
function rebuildAddSeries(){
  const sel=$('tfAdd');if(!sel)return;const cur=new Set(UI.trendState.series);
  sel.innerHTML='<option value="">＋ add series…</option>'+
    DB.points.filter(p=>p.addrs&&p.addrs.length&&!cur.has(p.id))
      .map(p=>`<option value="${esc(p.id)}">${esc(p.id)} · ${esc(trendShort(p))}</option>`).join('');
}
function drawTrend(){
  const cv=$('trendChart');if(!cv)return;
  const dpr=Math.min(devicePixelRatio,2),w=cv.clientWidth,h=cv.clientHeight;if(!w)return;
  if(cv.width!==w*dpr){cv.width=w*dpr;cv.height=h*dpr;}
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  const S=UI.trendState,now=Date.now(),winStart=S.tf>0?now-S.tf*1000:(S.t0||now-1000);
  const padL=8,padR=52,padT=8,padB=16,plotW=w-padL-padR,plotH=h-padT-padB;
  const series=[];
  S.series.forEach(id=>{const hh=UI.hist[id],p=byId[id];if(!hh||!p)return;
    const t=[],v=[];for(let i=0;i<hh.t.length;i++)if(hh.t[i]>=winStart){t.push(hh.t[i]);v.push(hh.v[i]);}
    if(t.length)series.push({id,p,t,v,col:trendColorFor(id)});});
  if(!series.length){x.fillStyle='rgba(154,163,178,.55)';x.font='600 11px ui-monospace,monospace';x.textAlign='center';
    x.fillText('Waiting for samples… add a point to trend',w/2,h/2);x.textAlign='left';
    const tp=$('trendTip');if(tp)tp.style.display='none';return;}
  let mn=Infinity,mx=-Infinity;series.forEach(s=>s.v.forEach(val=>{if(val<mn)mn=val;if(val>mx)mx=val;}));
  if(mn===mx){mn-=1;mx+=1;}const vp=(mx-mn)*.15;mn-=vp;mx+=vp;
  const tMin=winStart,tMax=now;
  const px=t=>padL+(tMax>tMin?(t-tMin)/(tMax-tMin):0)*plotW, py=val=>padT+(1-(val-mn)/(mx-mn))*plotH;
  x.font='600 9px ui-monospace,monospace';
  for(let i=0;i<=3;i++){const val=mn+(mx-mn)*i/3,y=py(val);
    x.strokeStyle='rgba(255,255,255,.06)';x.beginPath();x.moveTo(padL,y);x.lineTo(w-padR,y);x.stroke();
    x.fillStyle='rgba(154,163,178,.85)';x.fillText(val.toFixed(1),w-padR+4,y+3);}
  x.fillStyle='rgba(154,163,178,.85)';x.textAlign='center';
  [0,.5,1].forEach(f=>{const t=tMin+(tMax-tMin)*f,X=padL+f*plotW;x.fillText(clockHMS(t),Math.min(Math.max(X,20),w-padR-20),h-4);});
  x.textAlign='left';
  series.forEach(s=>{x.beginPath();x.strokeStyle=s.col;x.lineWidth=2;
    for(let i=0;i<s.t.length;i++){const X=px(s.t[i]),Y=py(s.v[i]);i?x.lineTo(X,Y):x.moveTo(X,Y);}x.stroke();
    const li=s.t.length-1,X=px(s.t[li]),Y=py(s.v[li]);
    x.beginPath();x.arc(X,Y,2.5,0,7);x.fillStyle=s.col;x.fill();
    x.font='700 9px ui-monospace,monospace';x.fillStyle=s.col;x.fillText(s.v[li].toFixed(1),Math.min(X+5,w-padR-1),Math.max(Y-4,10));});
  if(trendHover!=null){
    const tHov=tMin+(Math.min(Math.max(trendHover,padL),padL+plotW)-padL)/plotW*(tMax-tMin),X=px(tHov);
    x.strokeStyle='rgba(255,255,255,.22)';x.beginPath();x.moveTo(X,padT);x.lineTo(X,h-padB);x.stroke();
    let tip='';series.forEach(s=>{let bi=0,bd=Infinity;for(let i=0;i<s.t.length;i++){const d=Math.abs(s.t[i]-tHov);if(d<bd){bd=d;bi=i;}}
      const Y=py(s.v[bi]);x.beginPath();x.arc(X,Y,3,0,7);x.fillStyle=s.col;x.fill();x.strokeStyle='#0c0f15';x.lineWidth=2;x.stroke();
      tip+=`<span style="color:${s.col}">${esc(trendShort(s.p))} ${s.v[bi].toFixed(2)}${s.p.units?' '+esc(s.p.units):''}</span><br>`;});
    const tp=$('trendTip');tp.style.display='block';tp.style.left=Math.min(X+12,w-135)+'px';tp.style.top='6px';tp.innerHTML=tip;
  } else {const tp=$('trendTip');if(tp)tp.style.display='none';}
}

/* ---------- points table ---------- */
function fmtAddr(p){if(!p.addrs||!p.addrs.length)return p.id==='P01'?'DCOS':(p.id==='P26'?'CALC':'N/A');
  return p.addrs.length>1?`${p.addrs[0]} +${p.addrs.length-1}`:String(p.addrs[0]);}
function buildTable(){
  const tb=$('ptRows');tb.innerHTML='';
  PTS.forEach(p=>{
    const tr=document.createElement('tr');tr.className='prow';tr.id='pr_'+p.id;
    const dev=p.compliance==='Deviation';
    const na=!p.addrs.length&&p.id!=='P01'&&p.id!=='P26';
    tr.innerHTML=`<td class="nm" title="${esc(p.vendorName||'')}"><span class="q" id="q_${p.id}" style="margin-right:7px"></span>${esc(p.name)}${p.rw==='RW'?'<span class="badge rw">RW</span>':''}${dev?'<span class="badge dev">DEV</span>':''}${p.custom?'<span class="badge dev">NEW</span>':''}${na?'<span class="badge na">N/A</span>':''}</td>
      <td class="addr">${esc(fmtAddr(p))}</td>
      <td class="v num"><span id="pv_${p.id}">—</span>${p.units?`<small>${esc(p.units)}</small>`:''}</td>`;
    a11yClick(tr,()=>UI.selectPoint(p.id),'Select point '+p.name);
    tb.appendChild(tr);});
  $('ptCount').textContent=PTS.length;
  $('ptSearch').oninput=e=>{const q=e.target.value.toLowerCase();
    PTS.forEach(p=>{const hit=!q||p.name.toLowerCase().includes(q)||(p.vendorName||'').toLowerCase().includes(q)
      ||String(p.addrRaw||'').includes(q)||(p.severity||'').toLowerCase().includes(q);
      $('pr_'+p.id).style.display=hit?'':'none';});};
}
function updTable(){
  const reads=SIM.readAll();
  captureHist(reads);                          // per-point session history for the trends
  let tot=0,rx=0;
  reads.forEach(r=>{const p=byId[r.id]||DB.points.find(x=>x.id===r.id);
    if(!p||!p.addrs||!p.addrs.length)return;tot++;
    if(r.vals&&r.q&&r.q.code===192)rx++;});
  const rc=$('rxChip');
  if(rc){rc.textContent=`RX ${rx}/${tot}`;rc.className='chip '+(rx===tot?'ok':'bad');}
  reads.forEach(r=>{lastReads[r.id]=r;
    const v=$('pv_'+r.id),q=$('q_'+r.id),tr=$('pr_'+r.id);
    v.textContent=r.txt;
    q.className='q'+(r.q.code===24?' bad':(r.q.code===null?' na':''));
    tr.classList.toggle('isalarm',!!r.alarm);});
  if(selected)fillDetail(selected);
}
UI.selectPoint=function(id){
  selected=id;
  document.querySelectorAll('tr.prow').forEach(t=>t.classList.remove('sel'));
  const tr=$('pr_'+id);if(tr){tr.classList.add('sel');tr.scrollIntoView({block:'nearest',behavior:'smooth'});}
  fillDetail(id);
};
/* ---------- field "Read as…" — reinterpret a register live (like a real Modbus tool) ---------- */
const RA_MAP={
  uint16 :{span32:false,signed:'Unsigned',regType:'16int',  bit:null},
  int16  :{span32:false,signed:'Signed',  regType:'16int',  bit:null},
  uint32 :{span32:true, signed:'Unsigned',regType:'32int',  bit:null},
  int32  :{span32:true, signed:'Signed',  regType:'32int',  bit:null},
  float32:{span32:true, signed:'Unsigned',regType:'float32',bit:null},
  bool   :{span32:false,signed:'Unsigned',regType:'Boolean',bit:null}
};
const RA_LABEL={uint16:'uint16 · word',int16:'int16 · short',uint32:'uint32 · dword (2 reg)',
  int32:'int32 · long (2 reg)',float32:'float32 (2 reg)',bool:'bool · on/off'};
function fmtOf(p){
  const rt=(p.regType||'').toLowerCase();
  if(p.bit!=null)return '';                                  // bit-mapped: not one of the simple menu choices
  if(p.span32)return rt==='float32'?'float32':(p.signed==='Signed'?'int32':'uint32');
  if(rt.includes('bool'))return 'bool';
  return p.signed==='Signed'?'int16':'uint16';
}
function ensureDraftForEdit(){                                // AD-5: never mutate an approved revision in place
  const id=window.W1_ACTIVE_TEMPLATE&&W1_ACTIVE_TEMPLATE.id;
  if(!id||!window.REGISTRY)return null;
  const st=(W1_ACTIVE_TEMPLATE.registry&&W1_ACTIVE_TEMPLATE.registry.revStatus)||'approved';
  if(st==='approved'){const nr=REGISTRY.forkDraft(id);window.W1_FILLSPL&&W1_FILLSPL();
    toast(`✎ Approved list untouched — edits go to a new revision: ${nr.splVersion}`,'',4200);}
  return id;
}
function recomposeLive(id){                                   // re-decode the last raw words with the new interpretation
  if(!(window.LIVE&&LIVE.valuesLive&&LIVE.st&&LIVE.st.raw))return;
  const p=byId[id];if(!p)return;
  const o=LIVE.composePoint(p,LIVE.st.raw,LIVE.source!=='agent');o.ts=Date.now();
  LIVE.st.values[id]=o;
}
function applyReadEdit(id,label){
  UI.rebuildPoints&&UI.rebuildPoints();      // byId → the mutated object (a fork can swap SPL_DB objects)
  recomposeLive(id);                         // re-decode last raw words with the new interpretation
  updTable();
  fillDetail(id);try{drawTrend();}catch(e){}
  const T=window.W1_ACTIVE_TEMPLATE;
  const draft=T&&T.registry.revStatus==='field-draft';
  toast(`${label}${draft?' · field-draft (save & propose to persist)':''}`,'good',3000);
  const dev=T&&T.id;
  if(dev&&window.REGISTRY){REGISTRY.snapshotDraft(dev);
    if(window.W1AGENT&&W1AGENT.present){
      // Save the draft so the agent reads the point with its NEW span (a 32-bit
      // point now reads addr + addr+1), then poll once so the reinterpreted value
      // appears immediately instead of BAD-until-the-next-natural-poll.
      REGISTRY.saveDraft(dev)
        .then(()=>(window.LIVE&&LIVE.valuesLive)?LIVE.pollOnce():null)
        .then(()=>{if(window.LIVE&&LIVE.valuesLive){recomposeLive(id);updTable();
          if(selected===id)fillDetail(id);try{drawTrend();}catch(e){}}})
        .catch(()=>{});
    }
  }
}
function editDraftPoint(id){                   // fork a draft if needed, then resolve the live working-copy point (fork can swap SPL_DB objects)
  ensureDraftForEdit();return (window.SPL_DB.points||[]).find(x=>x.id===id);
}
UI.setReadAs=function(id,fmt){
  const m=RA_MAP[fmt];if(!m)return;
  const p=editDraftPoint(id);if(!p||!p.addrs||!p.addrs.length)return;
  Object.assign(p,m);applyReadEdit(id,`${id} → read as ${fmt}`);
};
UI.setWordOrder=function(id,order){
  const p=editDraftPoint(id);if(!p)return;
  p.wordOrder=order;applyReadEdit(id,`${id} word order → ${order.toUpperCase()}`);
};

function fillDetail(id){
  const p=byId[id],r=lastReads[id];if(!p)return;
  const g=p.gain!=null?p.gain:null;
  let rawLine='';
  if(r&&r.raws&&r.vals){rawLine=p.addrs.map((a,i)=>{
    if(r.vals[i]==null)return '';
    return `<div><span class="k">reg ${esc(a)}</span> raw <span class="hl">${r.raws[i]}</span>${g?` × ${g} → `:' → '}<span class="hl">${(+r.vals[i]).toFixed(r.dec??1)}</span> ${esc(p.units||'')} <span class="k">${esc(p.vendorNames[i]||'')}</span></div>`;}).join('');}
  const dev=p.compliance==='Deviation';
  $('ptDetail').innerHTML=`
    <h4>${esc(p.name)} <span style="color:var(--txt3);font-weight:500">· ${esc(p.id)} · class ${esc(p.cls)}${p.clsFlag&&p.clsFlag!=='A'?' ('+esc(p.clsFlag)+')':''}</span></h4>
    <div><span class="k">Vendor:</span> ${esc(p.vendorName||'—').replace(/\n/g,' · ')}</div>
    <div><span class="k">Modbus:</span> ${p.addrRaw?esc(p.addrRaw).replace(/\n/g,', '):'—'} · <span class="k">type</span> ${esc(p.regType||'—')} ${p.signed&&p.signed!=='N/A'?esc(p.signed):''} · <span class="k">read FC</span> ${esc(p.readFC||'—')}${p.writeFC&&p.writeFC!=='N/A'?' · <span class="k">write FC</span> '+esc(p.writeFC):''}</div>
    ${p.addrs&&p.addrs.length?`<div class="readas"><span class="k">Read as</span>
      <select id="raSel_${esc(p.id)}" title="Reinterpret the register(s) — the live value re-decodes instantly">
        ${Object.keys(RA_LABEL).map(f=>`<option value="${f}"${fmtOf(p)===f?' selected':''}>${RA_LABEL[f]}</option>`).join('')}
      </select>
      <button class="pbtn" id="raWord_${esc(p.id)}" title="Swap 32-bit word order (float / 32-bit only)">Word ${((p.wordOrder||'hilo')==='lohi')?'LO-HI':'HI-LO'}</button>
      <span class="k" style="font-size:9px">live re-decode → field-draft</span></div>`:''}
    ${p.addrs&&p.addrs.length?`<div style="margin:5px 0 2px"><button class="pbtn" id="trBtn_${esc(p.id)}">${UI.trendState.series.includes(p.id)?'− Remove from trend':'＋ Add to trend'}</button></div>`:''}
    ${p.min!=null?`<div><span class="k">Range:</span> ${p.min} … ${p.max} ${esc(p.units||'')} · <span class="k">gain</span> ${p.gain}</div>`:''}
    ${p.alarmDev&&(p.alarmDev.L||p.alarmDev.H)?`<div><span class="k">Alarm dev:</span> ${p.alarmDev.LL?'LL '+esc(p.alarmDev.LL)+'% ':''}${p.alarmDev.L?'L '+esc(p.alarmDev.L)+'% ':''}${p.alarmDev.H?'H '+esc(p.alarmDev.H)+'% ':''}${p.alarmDev.HH?'HH '+esc(p.alarmDev.HH)+'%':''} <span class="k">(% of range)</span></div>`:''}
    ${p.severity?`<div><span class="k">Severity:</span> ${esc(p.severity)}${p.notifyEng?' · notify engineers':''}</div>`:''}
    ${p.stateTable?`<div><span class="k">States:</span> ${(DB.stateTables[p.stateTable]||[]).map(([i,t])=>esc(i)+'='+esc(t)).join(' · ')}</div>`:''}
    ${p.floatStatus?`<div><span class="k">Value map:</span> ${esc(p.floatStatus).replace(/\n/g,' · ')}</div>`:''}
    ${r&&r.calc?`<div><span class="k">Calc:</span> ${esc(r.calc)}</div>`:''}
    ${rawLine}
    ${r?`<div><span class="k">Quality:</span> <span class="${r.q.code===24?'':''}" style="color:${r.q.code===24?'var(--crit)':r.q.code===null?'var(--txt3)':'var(--good)'}">${esc(r.q.txt)}</span></div>`:''}
    ${dev?`<div style="color:var(--warn)">▲ SPL DEVIATION — ${esc(p.vendorComment||'').replace(/\n/g,' ')}</div>`:''}
    ${!dev&&p.vendorComment?`<div><span class="k">Note:</span> ${esc(p.vendorComment).replace(/\n/g,' ')}</div>`:''}
    ${p.equinixComment?`<div><span class="k">Equinix:</span> ${esc(p.equinixComment).replace(/\n/g,' ')}</div>`:''}`;
  const raSel=$('raSel_'+id);if(raSel)raSel.onchange=e=>UI.setReadAs(id,e.target.value);
  const raWord=$('raWord_'+id);if(raWord)raWord.onclick=()=>UI.setWordOrder(id,((byId[id].wordOrder||'hilo')==='hilo')?'lohi':'hilo');
  const trBtn=$('trBtn_'+id);if(trBtn)trBtn.onclick=()=>UI.toggleTrend(id);
}

/* ---------- bench ---------- */
function wireBench(){
  $('btnBench').onclick=()=>$('bench').classList.toggle('open');
  $('loadSlider').oninput=e=>{const v=+e.target.value;$('loadVal').textContent=v+' kW';SIM.setLoad(v);};
  $('spSlider').oninput=e=>{$('spVal').textContent=(+e.target.value).toFixed(1)+' °C';};
  $('spApply').onclick=async()=>{const v=+$('spSlider').value;
    if(window.LIVE&&LIVE.valuesLive){
      if(!LIVE.armed){toast('🔒 SAFE mode — writes to the real device are disabled. Arm writes in the Test Bench first.','warn',4200);return;}
      const raw=Math.round(v*10);
      if(!confirm(`LIVE WRITE to the real device:\n\nFC06 → 40001 := ${raw}  (${v.toFixed(1)} °C)\nvia ${LIVE.target.ch}.${LIVE.target.dev}\n\nProceed?`))return;
      const res=await LIVE.write('P04',v);SCENE.writeBurst();
      if(res.ok){toast(`⛓ LIVE write OK → 40001 := ${res.raw} (${v.toFixed(1)} °C)`,'good');
        UI.log(`LIVE WRITE via gateway → 40001 := ${res.raw} (${v.toFixed(1)} °C) · writeResults s:true`,'wr');}
      else{toast(`LIVE write FAILED — ${res.detail.status||res.detail.err}`,'bad');
        UI.log(`LIVE WRITE FAILED → 40001 — ${res.detail.status||res.detail.err}`,'err');}
      return;}
    const res=SIM.writeSP(v);SCENE.writeBurst();
    if(res.overridden)toast(`⚠ Setpoint ${res.requested.toFixed(1)} °C below dew-point guard — controller applied <b>${res.applied.toFixed(1)} °C</b>`,'warn',4200);
    else toast(`FC06 write OK → 40001 := ${res.applied.toFixed(1)} °C`,'good');};
  document.querySelectorAll('.fbtn').forEach(b=>{
    b.onclick=()=>{const k=b.dataset.f,on=!b.classList.contains('on');
      b.classList.toggle('on',on);SIM.setFault(k,on);};});
  $('btnClearF').onclick=()=>{SIM.clearFaults();document.querySelectorAll('.fbtn:not(#btnArmWrites)').forEach(b=>b.classList.remove('on'));};
  const bw=$('btnArmWrites');
  if(bw)bw.onclick=()=>{LIVE.armed=!LIVE.armed;
    bw.classList.toggle('on',!!LIVE.armed);
    bw.textContent=LIVE.armed?'⚠ WRITES ARMED — click to disarm':'🔒 SAFE — writes disabled (click to ARM)';
    UI.updSafe();
    UI.log(LIVE.armed?'⚠ WRITE PROTECTION DISARMED — FC06 writes to the device are now possible':'Write protection restored — READ-ONLY','warn');};
  $('btnUnitOff').onclick=()=>{const on=!SIM.st.unitOn;SIM.setUnit(on);
    $('btnUnitOff').textContent=on?'⏻ Stop unit':'⏻ Start unit';};
}

/* ---------- alarm edge toasts ---------- */
let prevA={};
function alarmEdges(s){
  const map={leak:['💧 LEAK DETECTION ALARM — 10039 ACTIVE','bad'],
    lowflow:['🚨 PUMP LOW FLOW ALARM — 10029 (all pumps 100 %, flow < 80 % SP)','bad'],
    critical:['🔴 GENERAL ALARM (CRITICAL) — 10001 · severity HIGH · engineers notified','bad'],
    nonCritical:['🟠 GENERAL ALARM (NON-CRITICAL) — 10002','warn']};
  for(const k in map){const now=!!s.alarms[k];
    if(now&&!prevA[k]){toast(map[k][0],map[k][1]);UI.log(map[k][0],map[k][1]==='bad'?'err':'warn');}
    if(!now&&prevA[k]&&k!=='critical'&&k!=='nonCritical')UI.log(`Alarm cleared: ${k}`,'ok');
    prevA[k]=now;}
}

UI.updSafe=function(){const c=$('safeChip');if(!c)return;
  if(!(window.LIVE&&LIVE.valuesLive)){c.classList.add('hidden');return;}
  c.classList.remove('hidden');
  c.className='chip '+(LIVE.armed?'bad':'ok');
  c.innerHTML='<span class="dot"></span>'+(LIVE.armed?'WRITES ARMED':'READ-ONLY');};

/* ---------- data source chip ---------- */
UI.setSourceChip=function(){const el=$('simChipIn');if(!el)return;
  if(window.LIVE&&LIVE.enabled&&LIVE.valuesLive){el.className='chip ok';
    el.innerHTML='<span class="dot"></span>FULL LIVE · '+(LIVE.source==='agent'?'DIRECT MODBUS (AGENT)':'TOP SERVER');}
  else if(window.LIVE&&LIVE.enabled){el.className='chip acc';
    el.innerHTML='<span class="dot" style="background:var(--acc);box-shadow:0 0 8px var(--acc)"></span>LIVE CONFIG · VALUES SIMULATED';}
  else {el.className='chip warn';el.innerHTML='<span class="dot"></span>SIMULATED TELEMETRY';}
  UI.updSafe&&UI.updSafe();};

/* ---------- field lock (security air-gap) awareness ---------- */
UI.updFieldLock=function(){const c=$('fieldChip');if(!c)return;
  const on=!!(window.LIVE&&LIVE.valuesLive);   // connected to a real device → laptop is air-gapped
  if(on){c.classList.remove('hidden');
    if(!UI._fieldToast){UI._fieldToast=1;
      toast('🔒 Field lock engaged — while you are on the asset, WitnessONE blocks the central registry, TOP Server and every online/API connection.','',5600);}}
  else{c.classList.add('hidden');UI._fieldToast=0;}
};
/* ---------- link / poll ---------- */
function updLink(s){
  const bad=s.faults.comms;
  const lost=window.LIVE&&LIVE.valuesLive&&LIVE.st.failCount>=2;
  const lc=$('linkChip');lc.className='chip '+((bad||lost)?'bad':'ok');
  $('linkTxt').textContent=lost?'LINK · LOST — RETRYING':(bad?'LINK · BAD (24)':'LINK · GOOD (192)');
  UI.updFieldLock&&UI.updFieldLock();
}

/* ---------- init ---------- */
UI.rebuildPoints=function(){DB.points.forEach(p=>byId[p.id]=p);buildTable();updTable();};
function relabelForTemplate(){
  const T=window.W1_ACTIVE_TEMPLATE;if(!T)return;
  const q=(sel)=>document.querySelector(sel);
  const lt=q('#left .ptitle span');if(lt)lt.textContent=`Live Telemetry — ${W1_SPLFMT(T.registry.splVersion)}`;
  $('devMM')&&($('devMM').textContent=`${T.identity.make} · ${T.identity.model.length<=14?T.identity.model:T.identity.model.split(' ')[0]}`);
  $('ptCount')&&($('ptCount').textContent=DB.points.length);
  const badge=document.querySelector('#right .ptitle .badge.ok');if(badge)badge.textContent=T.registry.splVersion.replace(/ .*/, '').slice(0,8)||'SPL';
  if(!SIM.isCDU){
    const tw=q('#trendWrap .ptitle span');
    const series=GEN_TILES.filter(t=>!t.digital).slice(0,2).map(t=>DB.points.find(p=>p.id===t.id));
    if(tw&&series[0])tw.textContent=series.map(p=>p&&p.name).filter(Boolean).join(' · ')+(series[0]&&series[0].units?` — ${series[0].units}`:'');
    const leg=$('trendLegend');
    if(leg&&series[0]){leg.innerHTML=series.map((p,i)=>p?`<span class="li"><span class="sw" style="background:${[C.teal,C.orange][i]}"></span>${p.name.slice(0,20)}</span>`:'').join('');}
  }
}
UI.init=function(){
  buildTiles();buildTable();wireBench();relabelForTemplate();
  $('pollSel').onchange=e=>{const ms=+e.target.value;SIM.setPoll(ms);
    $('pollTxt').textContent='POLL '+(ms>=1000?(ms/1000)+' s':ms+' ms');
    UI.log(`Scan rate changed → ${ms} ms on ${DB.points.length} tags`,'acc');};
  $('btnXray').onclick=()=>{const on=SCENE.toggleXray();$('btnXray').style.background=on?'rgba(249,115,22,.25)':'';};
  $('btnAuto').onclick=()=>{SCENE.setAuto(true);};
  $('btnFocus').onclick=()=>SCENE.resetView();
  $('btnAbout').onclick=()=>$('aboutModal').classList.remove('hidden');
  $('btnAboutClose').onclick=()=>$('aboutModal').classList.add('hidden');
  const tc=$('trendChart');
  tc.addEventListener('pointermove',e=>{const r=tc.getBoundingClientRect();trendHover=e.clientX-r.left;});
  tc.addEventListener('pointerleave',()=>trendHover=null);
  UI.initTrend();
  document.querySelectorAll('#tfSeg .tfb').forEach(b=>b.onclick=()=>UI.setTrendTf(+b.dataset.tf));
  const tfAdd=$('tfAdd');if(tfAdd)tfAdd.onchange=e=>{const v=e.target.value;if(v){UI.addTrend(v);e.target.value='';}};
  // Expandable data panels: one panel at a time pops to a large overlay so the
  // trend / points table / test bench get real room and the 3D window shrinks.
  const syncMaxBtns=()=>document.querySelectorAll('.pbtn[data-max]').forEach(x=>{
    const t=document.getElementById(x.dataset.max),m=t&&t.classList.contains('max');
    x.textContent=m?'⤡':'⤢';x.title=m?'Restore':'Expand';});
  document.querySelectorAll('.pbtn[data-max]').forEach(b=>{
    b.onclick=()=>{const el=document.getElementById(b.dataset.max);if(!el)return;
      const open=!el.classList.contains('max');
      document.querySelectorAll('.panel.max,#bench.max').forEach(p=>p.classList.remove('max'));
      if(open)el.classList.add('max');
      syncMaxBtns();try{drawTrend();}catch(e){}};});
  addEventListener('keydown',e=>{if(e.key==='Escape'){const m=document.querySelector('.panel.max,#bench.max');
    if(m){m.classList.remove('max');syncMaxBtns();try{drawTrend();}catch(e){}}}});
  SIM.on('tick',s=>{updTiles(s);drawTrend();alarmEdges(s);updLink(s);});
  SIM.on('poll',()=>{updTable();if(!SIM.st.faults.comms)SCENE.pollBurst(46);
    if(window.LIVE&&LIVE.valuesLive&&!LIVE.pauseTwin)LIVE.pollOnce().then(()=>LIVE.applyToTwin());});
  SIM.on('event',e=>UI.log(e.msg,e.cls));
  UI.log(`WitnessONE dashboard bound — ${DB.points.length} ${window.W1_ACTIVE_TEMPLATE?window.W1_ACTIVE_TEMPLATE.registry.splVersion:'SPL'} points`,'acc');
};
})();
</script>
