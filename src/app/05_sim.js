<script>
/* ============ WitnessONE simulated register model — VERTIV XDU1350B ============
   Faithful to Equinix SPL 1.0: addresses, FCs, gains, ranges, state tables.
   Physics: 3× VSD pumps (N+1), dual plate HX, 2× 2-way primary valves (40 s stroke),
   PID supply-temp control w/ dew-point override.  Developed by MG. */
(function(){
const DB = window.SPL_DB;
const P = {}; DB.points.forEach(p=>P[p.id]=p);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a)=>(Math.random()*2-1)*a;

const SIM = window.SIM = {
  speed:1, pollMs:1000, t:0, connected:false,
  cfg:{ip:'192.168.10.51',port:502,unit:1,fw:'1.0b19',serial:'VXDU1350B-2647-0114'},
  st:{
    load:620, loadUI:620, sp:32.0, spWritten:32.0, dew:14.2,
    T1:28.2,T2:32.0,T4:43.5,T5:38.9,
    secFlow:700, priFlow:470,
    PS1:1.18,PS2:2.35,PS3:2.62,PS4:2.30, PS5:[0.071,0.078,0.066],
    valvePos:[46,46], valveCmd:[46,46], valveTarget:46,
    pumps:[{cmd:61,act:61,run:true,duty:true,fault:false},
           {cmd:61,act:60,run:true,duty:true,fault:false},
           {cmd:0,act:0,run:false,duty:false,fault:false}],
    unitOn:true, status:5, kW:618,
    faults:{leak:false,p1:false,p2:false,p3:false,fmSec:false,fmPri:false,lowflow:false,comms:false},
    alarms:{}, commAlarm:false, commTimer:0, dist:0
  },
  hist:{T2:[],T4:[],SP:[],secFlow:[],priFlow:[],kW:[],valve:[],pump:[],PS2:[]},
  HLEN:420,
  _l:{}, on(ev,fn){(this._l[ev]=this._l[ev]||[]).push(fn)},
  emit(ev,d){(this._l[ev]||[]).forEach(f=>f(d))},
  ev(msg,cls){this.emit('event',{msg,cls,t:Date.now()})},
  overrides:{pumps:[null,null,null], valve:null, disableStandby:false},
};

/* ---------- physics tick ---------- */
SIM._step = function(dt){
  const s=this.st; this.t+=dt;
  // load wander
  s.load = clamp(s.loadUI + 14*Math.sin(this.t/47) + 6*Math.sin(this.t/13), 0, 1400);
  // disturbance lowpass (setpoint/load steps create transient)
  s.dist += ( (Math.abs(s.load - (s._lastLoad||s.load))>40 ? 0.9 : 0) - s.dist )*dt*0.12;
  s._lastLoad = s.load;

  // ----- pump duty / standby logic -----
  const F=s.faults;
  [F.p1,F.p2,F.p3].forEach((f,i)=>{ s.pumps[i].fault=f; if(f){s.pumps[i].run=false;} });
  if(s.unitOn){
    const healthy=s.pumps.filter(p=>!p.fault);
    let running=s.pumps.filter(p=>p.run&&!p.fault);
    if(running.length<2 && !this.overrides.disableStandby){
      const cand=s.pumps.find(p=>!p.fault&&!p.run);
      if(cand){cand.run=true;cand.duty=true;this.ev(`Standby pump P${s.pumps.indexOf(cand)+1} AUTO-START (N+1 changeover)`,'warn');}
    }
    if(healthy.length===0){ if(s.status!==8){s.status=8;this.ev('ALL PUMPS UNAVAILABLE — unit SHUTDOWN – FAULT (status 8)','err');} }
    else if(s.status!==5){ s.status=5; }
  } else { s.pumps.forEach(p=>p.run=false); s.status=4; }

  // ----- flow controller (targets ~1.13 L/min per kW, min 320) -----
  const targetFlow = clamp(Math.max(320, s.load*1.13), 0, 1725);
  const runners = s.pumps.filter(p=>p.run);
  const nRun = Math.max(runners.length,1);
  let cmd = clamp(targetFlow/(nRun*5.75), 25, 100);
  s.pumps.forEach((p,i)=>{
    const ov=this.overrides.pumps[i];
    const c = ov!=null ? ov : (p.run? cmd:0);
    p.cmd = clamp(c,0,100);
    const slew = 9*dt;
    p.act += clamp(p.cmd-p.act, -slew*3, slew*(p.act<p.cmd?1:3)) + (p.run?rnd(0.25):0);
    p.act = clamp(p.act,0,100); if(!p.run && p.cmd===0) p.act=Math.max(0,p.act-14*dt);
  });
  const sumAct = s.pumps.reduce((a,p)=>a+p.act,0);
  const flowFactor = F.lowflow?0.52:1;
  s.secFlow = clamp(sumAct*5.75*flowFactor + rnd(4), 0, 1725);
  // low-flow alarm: all running pumps ~100% and flow < 80% target (vendor note)
  const allMax = runners.length>0 && runners.every(p=>p.cmd>=99.5);
  s._lfT = (allMax && s.secFlow < 0.8*targetFlow) ? (s._lfT||0)+dt : 0;
  const lowFlowAlm = s._lfT>4;

  // ----- valve PID on T2 (parallel CV1+CV2, 40 s stroke) -----
  const err = s.T2 - s.sp;
  s.valveTarget = this.overrides.valve!=null ? this.overrides.valve
    : clamp(s.valveTarget + (err*6 + (s._errPrev!=null?(err-s._errPrev)/Math.max(dt,.01)*14:0))*dt*0.9, 4, 100);
  s._errPrev = err;
  const vslew = 2.5*dt; // 100% / 40 s
  s.valveCmd[0]=s.valveCmd[1]=Math.round(clamp(s.valveTarget,0,100));
  for(let i=0;i<2;i++) s.valvePos[i]=clamp(s.valvePos[i]+clamp(s.valveTarget-s.valvePos[i],-vslew,vslew),0,100);
  const vAvg=(s.valvePos[0]+s.valvePos[1])/2;
  s.priFlow = clamp(vAvg*9.6*(s.unitOn?1:0.15) + rnd(5), 0, 1725);

  // ----- thermal -----
  const cool = (vAvg/100)*(s.unitOn?1:0.05);
  const ssErr = (s.load/1350)*0.4*(1.05-cool) + s.dist*0.7;
  const t2target = (s.unitOn? s.sp+ssErr : s.T2+ (s.load>50?0.25*dt:0));
  s.T2 += (t2target - s.T2)*dt*0.16 + rnd(0.035);
  const dT = s.load*14.33/Math.max(s.secFlow,60);
  if(s.secFlow<100) s.T4 += ((s.T2+2)-s.T4)*dt*0.02 + rnd(0.02); // stagnant loop: sensor drifts, no transport
  else s.T4 += ((s.T2+dT)-s.T4)*dt*0.3 + rnd(0.04);
  s.T1 += ((26.4 + 0.7*Math.sin(this.t/120) + (vAvg-45)*0.006) - s.T1)*dt*0.2 + rnd(0.02);
  const dTp = s.load*14.33/Math.max(s.priFlow,60);
  s.T5 += ((s.T1+dTp)-s.T5)*dt*0.3 + rnd(0.04);
  s.kW = 4.186*(s.secFlow/60)*Math.max(s.T4-s.T2,0);

  // ----- pressures -----
  s.PS1 = 1.18 + rnd(0.008);
  s.PS2 = s.PS1 + Math.pow(sumAct/ (200) ,2)*3.1 + rnd(0.012);
  s.PS3 = 2.62 + rnd(0.01);
  s.PS4 = s.PS3 - 0.84*Math.pow(s.priFlow/1200,2) + rnd(0.01);
  for(let i=0;i<3;i++) s.PS5[i]=clamp(0.062+i*0.007 + this.t*0.000012 + rnd(0.0025),0,0.5);

  // ----- comms watchdog (DCOS software point) -----
  if(F.comms){ s.commTimer+=dt; if(s.commTimer>8 && !s.commAlarm){s.commAlarm=true;this.ev('DCOS watchdog: COMMUNICATION ALARM raised (poll timeout ×3)','err');} }
  else { if(s.commAlarm) this.ev('DCOS watchdog: communication restored — alarm cleared','ok'); s.commAlarm=false; s.commTimer=0; }

  // ----- alarm word -----
  const anyPumpF = F.p1||F.p2||F.p3;
  const span=75, hiDev=0.01*span, loDev=0.02*span; // SPL: T2 High 1% / Low 2% (% of range)
  s._t2hiT = (s.T2 > s.sp+hiDev)? (s._t2hiT||0)+dt : 0;
  s._t2loT = (s.T2 < s.sp-loDev)? (s._t2loT||0)+dt : 0;
  const A = s.alarms;
  A.leak=F.leak; A.p1=F.p1; A.p2=F.p2; A.p3=F.p3; A.fmSec=F.fmSec; A.fmPri=F.fmPri;
  A.lowflow=lowFlowAlm||F.lowflow&&lowFlowAlm; A.t2hi=s._t2hiT>18; A.t2lo=s._t2loT>18;
  A.critical = A.leak || A.lowflow || s.status===8 || (anyPumpF && s.secFlow<0.9*targetFlow);
  A.nonCritical = A.fmSec || A.fmPri || anyPumpF || A.t2hi || A.t2lo;

};
/* numerically-stable tick: subdivide large demo-speed steps (explicit Euler stays stable) */
SIM.tick = function(dtms){
  const total=(dtms/1000)*this.speed, n=Math.max(1,Math.ceil(total/1.2));
  for(let k=0;k<n;k++)this._step(total/n);
  const s=this.st;
  const H=this.hist, push=(k,v)=>{H[k].push(v); if(H[k].length>this.HLEN)H[k].shift();};
  const vAvg=(s.valvePos[0]+s.valvePos[1])/2, sumAct=s.pumps.reduce((a,p)=>a+p.act,0);
  push('T2',s.T2);push('T4',s.T4);push('SP',s.sp);push('secFlow',s.secFlow);push('priFlow',s.priFlow);
  push('kW',s.kW);push('valve',vAvg);push('pump',sumAct/3);push('PS2',s.PS2);
  this.emit('tick',s);
};

/* ---------- register reads (SPL-faithful) ---------- */
const QG={code:192,txt:'GOOD (192)'}, QB={code:24,txt:'BAD – COMM FAILURE (24)'}, QNA={code:null,txt:'N/A BY DESIGN'}, QSW={code:192,txt:'DCOS SOFTWARE POINT'};
const stText={}; (DB.stateTables.NORMAL_ALARM||[]).forEach(([i,t])=>stText['NA'+i]=t);
const unitStates={}; ((P.P02&&P.P02.floatStatus)||'').split('\n').forEach(l=>{const m=l.match(/^(\d+)\s*=\s*(.+)$/); if(m)unitStates[+m[1]]=m[2].trim();});
SIM.unitStates=unitStates;

/* ---------- GENERIC simulator (any non-CDU template) ---------- */
SIM.isCDU=(window.W1_ACTIVE_TEMPLATE&&window.W1_ACTIVE_TEMPLATE.id==='vertiv-xdu1350b-cdu');
function plausible(p){
  const n=(p.name||'').toLowerCase(),u=(p.units||'').toLowerCase().replace(/[^a-z%°]/g,'');
  const map=[['thd',2.1],['current unbal',1.4],['voltage unbal',0.8],['power factor',0.95],['factor',0.95],
    ['battery amps',12],['voltage a-n',277],['voltage b-n',277],['voltage c-n',277],['voltage',480],
    ['current',212],['frequency',60],['humidity',52],['kwh',48210],['kvar',38],['kva',172],['kw',165],
    ['temperature',u.includes('f')?75:24],['temp',u.includes('f')?75:24],['setpoint',u.includes('f')?62:22],
    ['battery',54],['amps',45],['minutes',30],['load',48],['%',55]];
  let base=null;
  for(const [kw,v] of map){ if(n.includes(kw)){ base=v; break; } }
  if(base==null){ // fall back to the engineering unit (SPL ranges are often raw register spans)
    const um={hz:60,v:480,kv:0.48,a:212,ka:0.21,'%':55,'°c':24,'°f':75,kw:165,kva:172,kvar:38,var:38,kwh:48210,wh:48210,min:30,pf:0.95};
    if(um[u]!=null)base=um[u];
  }
  const hasR=p.min!=null&&p.max!=null&&p.max>p.min;
  if(base!=null)return hasR?Math.max(p.min,Math.min(p.max,base)):base;
  if(hasR){ // no semantic hint: mid-range only when the range looks like engineering units, not a raw word span
    if(p.max-p.min<=10000){const lo=p.min+(p.max-p.min)*0.15,hi=p.max-(p.max-p.min)*0.15;return (lo+hi)/2;}
    return Math.min(64,p.max);
  }
  return 42;
}
SIM.genState={};
DB.points.forEach(p=>{ if(p.addrs&&p.addrs.length){SIM.genState[p.id]={base:plausible(p),on:0};} });
SIM.genericRead=function(id){
  const p=P[id];
  if(!p||!p.addrs||!p.addrs.length){
    if(p&&(p.readFC==null))return {id,vals:null,raws:null,q:{code:null,txt:'DCOS SOFTWARE POINT'},txt:p.stateTable?'NORMAL':'—',na:!p.stateTable};
    return {id,vals:null,raws:null,q:{code:null,txt:'N/A BY DESIGN'},txt:'—',na:true};
  }
  const g=p.gain||1, st=SIM.genState[id]||{base:plausible(p),on:0};
  const isB=(p.regType==='Boolean')||(p.bit!=null);
  const dec=g===0.1?1:g===0.01?2:g===0.001?3:0;
  if(isB){ const v=st.on?1:0;
    const on=p.status1||'ON', off=p.status0||'OFF';
    return {id,vals:[v],raws:[v],q:QG,txt:(v?on:off),alarm:!!v&&(p.stateTable==='NORMAL_ALARM')}; }
  if(p.stateTable&&p.min==null){ const v=Math.round(st.base)%1;
    return {id,vals:[v],raws:[v],q:QG,txt:String(v)}; }
  // one value per mapped register (multi-register points show all)
  const nreg=Math.max(1,(p.addrs||[]).length);
  const vals=[],raws=[];
  for(let i=0;i<nreg;i++){const v=st.base*(1+0.008*Math.sin(SIM.t/7+id.charCodeAt(1)+i*1.3))+rnd(g*2);
    vals.push(v);raws.push(Math.round(v/g));}
  return {id,vals,raws,q:QG,dec,txt:vals.map(v=>v.toFixed(dec)).join(' / ')};
};
SIM.setBool=function(id,on){ if(SIM.genState[id])SIM.genState[id].on=on?1:0; };

/* recompute point map / mode when the active template changes */
SIM.rebind=function(){
  Object.keys(P).forEach(k=>delete P[k]);
  DB.points.forEach(p=>P[p.id]=p);
  SIM.isCDU=(window.W1_ACTIVE_TEMPLATE&&window.W1_ACTIVE_TEMPLATE.id==='vertiv-xdu1350b-cdu');
  SIM.genState={};
  DB.points.forEach(p=>{ if(p.addrs&&p.addrs.length){SIM.genState[p.id]={base:plausible(p),on:0};} });
  const us={}; ((P.P02&&P.P02.floatStatus)||'').split('\n').forEach(l=>{const m=l.match(/^(\d+)\s*=\s*(.+)$/); if(m)us[+m[1]]=m[2].trim();});
  SIM.unitStates=us;
};

SIM.read = function(id){
  const s=this.st, p=P[id];
  if(s.faults.comms && id!=='P01')
    return {id,vals:null,raws:null,q:QB,txt:'—',stale:true};
  if(!SIM.isCDU) return SIM.genericRead(id);
  const mk=(vals,dec,q)=>{
    const g = p.gain||1;
    const raws = vals.map(v=>Math.round(v/g));
    return {id, vals, raws, q:q||QG, dec, txt:vals.map(v=>v.toFixed(dec)).join(' / ')};
  };
  switch(id){
    case 'P01': return {id,vals:[s.commAlarm?1:0],raws:null,q:QSW,txt:s.commAlarm?'ALARM':'NORMAL',alarm:s.commAlarm};
    case 'P02': return {id,vals:[s.status],raws:[s.status],q:QG,txt:`${s.status} · ${(unitStates[s.status]||'?').toUpperCase()}`};
    case 'P03': return mk(s.pumps.map(p=>p.act),0);
    case 'P04': return mk([s.sp],1);
    case 'P05': return mk([s.valvePos[0],s.valvePos[1]],0);
    case 'P06': return mk([s.T1],1);
    case 'P07': return mk([s.T5],1);
    case 'P08': {const r=mk([s.T2],1); r.alarm=s.alarms.t2hi||s.alarms.t2lo; return r;}
    case 'P09': return mk([s.T4],1);
    case 'P10': return mk([s.PS3],2);
    case 'P11': return mk([s.PS4],2);
    case 'P12': return mk([s.PS2],2);
    case 'P13': return mk([s.PS1],2);
    case 'P14': return mk([s.priFlow],0);
    case 'P15': return mk([s.secFlow],0);
    case 'P16': return {id,vals:null,raws:null,q:QNA,txt:'—',na:true,note:'No primary filter in XDU1350B STD'};
    case 'P17': return mk(s.PS5,2);
    case 'P18': return mk([s.PS2-s.PS1],2);
    case 'P19': {const c=s.alarms.critical?1:0,n=s.alarms.nonCritical?1:0;
      return {id,vals:[c,n],raws:[c,n],q:QG,txt:`${c?'ALARM':'NORMAL'} / ${n?'ALARM':'NORMAL'}`,alarm:!!(c||n)};}
    case 'P20': {const a=s.alarms.lowflow?1:0;return {id,vals:[a],raws:[a],q:QG,txt:a?'ALARM':'NORMAL',alarm:!!a};}
    case 'P21': return {id,vals:null,raws:null,q:QNA,txt:'—',na:true,note:'Covered by 3-pump design (see Pump A Low Flow)'};
    case 'P22': {const a=s.faults.fmSec?1:0,b=s.faults.fmPri?1:0;
      return {id,vals:[a,b],raws:[a,b],q:QG,txt:`${a?'ALARM':'NORM'} / ${b?'ALARM':'NORM'}`,alarm:!!(a||b)};}
    case 'P23': return mk([s.valveCmd[0],s.valveCmd[1]],0);
    case 'P24': {const a=s.faults.leak?1:0;return {id,vals:[a],raws:[a],q:QG,txt:a?'ALARM':'NORMAL',alarm:!!a};}
    case 'P25': {const v=[s.faults.p1?1:0,s.faults.p2?1:0,s.faults.p3?1:0];
      return {id,vals:v,raws:v,q:QG,txt:v.map(x=>x?'FLT':'OK').join('/'),alarm:v.some(x=>x)};}
    case 'P26': return {id,vals:[s.kW],raws:null,q:QG,dec:0,txt:s.kW.toFixed(0),calc:'DCOSC = 4.186 × (SecFlow/60) × (T4 − T2)'};
  }
  // field-added registers: no simulator model — read live by address (agent / gateway)
  return {id,vals:null,raws:null,q:{code:null,txt:'NO DATA — field-added register (live reads only)'},txt:'—',custom:true};
};
SIM.readAll = function(){ return DB.points.map(p=>SIM.read(p.id)); };

/* ---------- actions ---------- */
SIM.writeSP = function(v){
  const s=this.st; v=Math.round(v*10)/10;
  const spl=P.P04; v=clamp(v, spl.min, spl.max);
  let final=v, note='';
  if(v < s.dew+3){ final=Math.round((s.dew+3)*10)/10; note=` → OVERRIDDEN to ${final.toFixed(1)} °C (dew-point control active: dew ${s.dew.toFixed(1)} °C + 3 K guard)`; }
  const raw=Math.round(final/ (spl.gain||1));
  this.ev(`WRITE FC06 → 40001 (0x0000) := ${raw} (${final.toFixed(1)} °C)${note}`,'wr');
  s.spWritten=v; s.sp=final; s.dist=Math.min(1,s.dist+0.5);
  this.emit('write',{addr:40001,raw,val:final});
  return {requested:v, applied:final, overridden:final!==v};
};
SIM.setFault=function(k,on){ this.st.faults[k]=on;
  const names={leak:'Leak detection input',p1:'P1 inverter fault',p2:'P2 inverter fault',p3:'P3 inverter fault',
    fmSec:'Secondary flow-meter sensor fault',fmPri:'Primary flow-meter sensor fault',lowflow:'Strainer blockage (low-flow)',comms:'Modbus TCP link'};
  if(k==='comms') this.ev(on?'⚠ Modbus TCP link DOWN — device 192.168.10.51 not responding':'Modbus TCP link RESTORED — re-polling 26 tags','warn');
  else this.ev(`${on?'INJECT':'CLEAR'} · ${names[k]}`, on?'warn':'ok');
  if(k==='p1'&&!on){const p=this.st.pumps[0];p.fault=false;}
  if(k==='p2'&&!on){this.st.pumps[1].fault=false;}
  if(k==='p3'&&!on){this.st.pumps[2].fault=false;}
};
SIM.clearFaults=function(){ Object.keys(this.st.faults).forEach(k=>{ if(this.st.faults[k]) this.setFault(k,false); });
  this.st.pumps.forEach((p,i)=>{p.fault=false; if(i<2){p.run=this.st.unitOn;p.duty=true}else{p.run=false;p.duty=false}}); };
SIM.setUnit=function(on){ this.st.unitOn=on;
  if(on){this.st.pumps.forEach((p,i)=>{if(i<2&&!p.fault){p.run=true;p.duty=true}});this.ev('Unit START command — pumps resuming duty (status → 5 ONLINE)','ok');}
  else this.ev('Unit STOP command — pumps to standstill (status → 4 STANDBY)','warn'); };
SIM.setLoad=function(kw){ this.st.loadUI=clamp(kw,0,1350); };

/* ---------- poll loop ---------- */
let pollTimer=null;
SIM.start=function(){ if(pollTimer)return; const loop=()=>{ SIM.tick(SIM.pollMs); SIM.emit('poll'); pollTimer=setTimeout(loop,SIM.pollMs); }; loop(); };
SIM.setPoll=function(ms){ SIM.pollMs=ms; };
})();
</script>
