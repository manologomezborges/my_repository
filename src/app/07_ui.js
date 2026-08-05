<script>
/* ============ WitnessONE dashboard UI ============ MG */
(function(){
const UI = window.UI = {};
const $=id=>document.getElementById(id);
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
    d.innerHTML=`<div class="tl"><span class="name">${p.name}</span></div>
      <div class="val num"><span id="tv_${p.id}">—</span><small>${p.units||''}</small></div>
      <div class="sub"><span id="tsub_${p.id}"></span></div>
      <canvas id="tsp_${p.id}" width="76" height="30" style="width:76px;height:30px"></canvas>`;
    d.onclick=()=>UI.selectPoint(p.id);host.appendChild(d);});
  if(digital.length){grp(`Status & alarms — ${digital.length} points`,C.orange);
    digital.slice(0,6).forEach(p=>{GEN_TILES.push({id:p.id,col:C.orange,unit:'',digital:true});
      const d=document.createElement('div');d.className='tile';d.id='tile_'+p.id;
      d.innerHTML=`<div class="tl"><span class="name">${p.name}</span></div>
        <div class="val num" style="font-size:14px"><span id="tv_${p.id}">—</span></div>
        <div class="sub"><span id="tsub_${p.id}">${p.addrRaw||''}</span></div>`;
      d.onclick=()=>UI.selectPoint(p.id);host.appendChild(d);});}
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
    d.onclick=()=>UI.selectPoint(t.pt);
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
function drawTrendGeneric(){
  const cv=$('trendChart');const dpr=Math.min(devicePixelRatio,2);
  const w=cv.clientWidth,h=cv.clientHeight;if(!w)return;
  if(cv.width!==w*dpr){cv.width=w*dpr;cv.height=h*dpr;}
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  const series=(GEN_TILES.filter(t=>!t.digital&&genHist[t.id]&&genHist[t.id].length>2)).slice(0,2);
  if(!series.length)return;
  const N=Math.min(...series.map(s=>genHist[s.id].length),240);
  let mn=Infinity,mx=-Infinity;series.forEach(s=>genHist[s.id].slice(-N).forEach(v=>{if(v<mn)mn=v;if(v>mx)mx=v;}));
  const pad=Math.max((mx-mn)*.18,.5);mn-=pad;mx+=pad;
  const px=i=>10+i/(N-1)*(w-42),py=v=>h-14-(v-mn)/(mx-mn)*(h-26);
  x.strokeStyle='rgba(255,255,255,.05)';x.font='600 9px Inter,Arial';x.fillStyle='rgba(154,163,178,.7)';
  for(let i=0;i<=3;i++){const v=mn+(mx-mn)*i/3,y=py(v);x.beginPath();x.moveTo(10,y);x.lineTo(w-32,y);x.stroke();
    x.fillText(v.toFixed(mx-mn<10?1:0),w-28,y+3);}
  series.forEach(s=>{const d=genHist[s.id].slice(-N);x.beginPath();
    for(let i=0;i<d.length;i++)i?x.lineTo(px(i),py(d[i])):x.moveTo(px(i),py(d[i]));
    x.strokeStyle=s.col;x.lineWidth=2;x.stroke();});
}
function drawTrend(){
  if(!SIM.isCDU)return drawTrendGeneric();
  const cv=$('trendChart');const dpr=Math.min(devicePixelRatio,2);
  const w=cv.clientWidth,h=cv.clientHeight;if(!w)return;
  if(cv.width!==w*dpr){cv.width=w*dpr;cv.height=h*dpr;}
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  const H=SIM.hist,n=H.T2.length;if(n<2)return;
  const N=Math.min(n,240),o=n-N;
  const T2=H.T2.slice(o),T4=H.T4.slice(o),SP=H.SP.slice(o);
  let mn=Infinity,mx=-Infinity;[...T2,...T4,...SP].forEach(v=>{if(v<mn)mn=v;if(v>mx)mx=v;});
  const pad=Math.max((mx-mn)*.18,.6);mn-=pad;mx+=pad;
  const px=i=>10+i/(N-1)*(w-42), py=v=>h-14-(v-mn)/(mx-mn)*(h-26);
  // recessive grid + labels
  x.strokeStyle='rgba(255,255,255,.05)';x.lineWidth=1;x.font='600 9px Inter,Arial';x.fillStyle='rgba(154,163,178,.7)';
  for(let i=0;i<=3;i++){const v=mn+(mx-mn)*i/3,y=py(v);
    x.beginPath();x.moveTo(10,y);x.lineTo(w-32,y);x.stroke();x.fillText(v.toFixed(1),w-28,y+3);}
  const line=(D,col,dash)=>{x.beginPath();x.setLineDash(dash||[]);
    for(let i=0;i<N;i++)i?x.lineTo(px(i),py(D[i])):x.moveTo(px(i),py(D[i]));
    x.strokeStyle=col;x.lineWidth=dash?1.4:2;x.stroke();x.setLineDash([]);};
  line(SP,'rgba(154,163,178,.9)',[4,4]);line(T4,C.orange);line(T2,C.teal);
  // hover crosshair
  if(trendHover!=null){const i=Math.round((trendHover-10)/(w-42)*(N-1));
    if(i>=0&&i<N){const X=px(i);x.strokeStyle='rgba(255,255,255,.25)';
      x.beginPath();x.moveTo(X,6);x.lineTo(X,h-14);x.stroke();
      [[T2[i],C.teal],[T4[i],C.orange]].forEach(([v,c])=>{x.beginPath();x.arc(X,py(v),3.5,0,7);
        x.fillStyle=c;x.fill();x.strokeStyle='#0c0f15';x.lineWidth=2;x.stroke();});
      const tip=$('trendTip');tip.style.display='block';
      tip.style.left=Math.min(X+12,w-120)+'px';tip.style.top='8px';
      tip.innerHTML=`<span style="color:${C.teal}">T2 ${T2[i].toFixed(2)} °C</span><br>
        <span style="color:${C.orangeH}">T4 ${T4[i].toFixed(2)} °C</span><br>
        <span style="color:${C.txt3}">SP ${SP[i].toFixed(1)} °C</span>`;}}
  else $('trendTip').style.display='none';
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
    tr.innerHTML=`<td class="nm" title="${(p.vendorName||'').replace(/"/g,'')}"><span class="q" id="q_${p.id}" style="margin-right:7px"></span>${p.name}${p.rw==='RW'?'<span class="badge rw">RW</span>':''}${dev?'<span class="badge dev">DEV</span>':''}${p.custom?'<span class="badge dev">NEW</span>':''}${na?'<span class="badge na">N/A</span>':''}</td>
      <td class="addr">${fmtAddr(p)}</td>
      <td class="v num"><span id="pv_${p.id}">—</span>${p.units?`<small>${p.units}</small>`:''}</td>`;
    tr.onclick=()=>UI.selectPoint(p.id);
    tb.appendChild(tr);});
  $('ptCount').textContent=PTS.length;
  $('ptSearch').oninput=e=>{const q=e.target.value.toLowerCase();
    PTS.forEach(p=>{const hit=!q||p.name.toLowerCase().includes(q)||(p.vendorName||'').toLowerCase().includes(q)
      ||String(p.addrRaw||'').includes(q)||(p.severity||'').toLowerCase().includes(q);
      $('pr_'+p.id).style.display=hit?'':'none';});};
}
function updTable(){
  const reads=SIM.readAll();
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
function fillDetail(id){
  const p=byId[id],r=lastReads[id];if(!p)return;
  const g=p.gain!=null?p.gain:null;
  let rawLine='';
  if(r&&r.raws&&r.vals){rawLine=p.addrs.map((a,i)=>{
    if(r.vals[i]==null)return '';
    return `<div><span class="k">reg ${a}</span> raw <span class="hl">${r.raws[i]}</span>${g?` × ${g} → `:' → '}<span class="hl">${(+r.vals[i]).toFixed(r.dec??1)}</span> ${p.units||''} <span class="k">${p.vendorNames[i]||''}</span></div>`;}).join('');}
  const dev=p.compliance==='Deviation';
  $('ptDetail').innerHTML=`
    <h4>${p.name} <span style="color:var(--txt3);font-weight:500">· ${p.id} · class ${p.cls}${p.clsFlag&&p.clsFlag!=='A'?' ('+p.clsFlag+')':''}</span></h4>
    <div><span class="k">Vendor:</span> ${(p.vendorName||'—').replace(/\n/g,' · ')}</div>
    <div><span class="k">Modbus:</span> ${p.addrRaw?p.addrRaw.replace(/\n/g,', '):'—'} · <span class="k">type</span> ${p.regType||'—'} ${p.signed&&p.signed!=='N/A'?p.signed:''} · <span class="k">read FC</span> ${p.readFC||'—'}${p.writeFC&&p.writeFC!=='N/A'?' · <span class="k">write FC</span> '+p.writeFC:''}</div>
    ${p.min!=null?`<div><span class="k">Range:</span> ${p.min} … ${p.max} ${p.units||''} · <span class="k">gain</span> ${p.gain}</div>`:''}
    ${p.alarmDev&&(p.alarmDev.L||p.alarmDev.H)?`<div><span class="k">Alarm dev:</span> ${p.alarmDev.LL?'LL '+p.alarmDev.LL+'% ':''}${p.alarmDev.L?'L '+p.alarmDev.L+'% ':''}${p.alarmDev.H?'H '+p.alarmDev.H+'% ':''}${p.alarmDev.HH?'HH '+p.alarmDev.HH+'%':''} <span class="k">(% of range)</span></div>`:''}
    ${p.severity?`<div><span class="k">Severity:</span> ${p.severity}${p.notifyEng?' · notify engineers':''}</div>`:''}
    ${p.stateTable?`<div><span class="k">States:</span> ${(DB.stateTables[p.stateTable]||[]).map(([i,t])=>i+'='+t).join(' · ')}</div>`:''}
    ${p.floatStatus?`<div><span class="k">Value map:</span> ${p.floatStatus.replace(/\n/g,' · ')}</div>`:''}
    ${r&&r.calc?`<div><span class="k">Calc:</span> ${r.calc}</div>`:''}
    ${rawLine}
    ${r?`<div><span class="k">Quality:</span> <span class="${r.q.code===24?'':''}" style="color:${r.q.code===24?'var(--crit)':r.q.code===null?'var(--txt3)':'var(--good)'}">${r.q.txt}</span></div>`:''}
    ${dev?`<div style="color:var(--warn)">▲ SPL DEVIATION — ${(p.vendorComment||'').replace(/\n/g,' ')}</div>`:''}
    ${!dev&&p.vendorComment?`<div><span class="k">Note:</span> ${p.vendorComment.replace(/\n/g,' ')}</div>`:''}
    ${p.equinixComment?`<div><span class="k">Equinix:</span> ${p.equinixComment.replace(/\n/g,' ')}</div>`:''}`;
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

/* ---------- link / poll ---------- */
function updLink(s){
  const bad=s.faults.comms;
  const lost=window.LIVE&&LIVE.valuesLive&&LIVE.st.failCount>=2;
  const lc=$('linkChip');lc.className='chip '+((bad||lost)?'bad':'ok');
  $('linkTxt').textContent=lost?'LINK · LOST — RETRYING':(bad?'LINK · BAD (24)':'LINK · GOOD (192)');
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
  SIM.on('tick',s=>{updTiles(s);drawTrend();alarmEdges(s);updLink(s);});
  SIM.on('poll',()=>{updTable();if(!SIM.st.faults.comms)SCENE.pollBurst(46);
    if(window.LIVE&&LIVE.valuesLive&&!LIVE.pauseTwin)LIVE.pollOnce().then(()=>LIVE.applyToTwin());});
  SIM.on('event',e=>UI.log(e.msg,e.cls));
  UI.log(`WitnessONE dashboard bound — ${DB.points.length} ${window.W1_ACTIVE_TEMPLATE?window.W1_ACTIVE_TEMPLATE.registry.splVersion:'SPL'} points`,'acc');
};
})();
</script>
