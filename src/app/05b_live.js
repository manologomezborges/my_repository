<script>
/* ============ WitnessONE LIVE link — TOP Server Configuration API client ============
   Speaks the real Kepware-platform Config API (/config/v1, Basic auth, PROJECT_ID,
   bulk tag POST w/ 207 multi-status) and the IoT-Gateway-style live surface
   (/iotgateway/read|write). Values fall back to the simulator when no live
   value endpoint is licensed/configured — clearly labeled.  MG */
(function(){
const DB=window.SPL_DB;
const LIVE=window.LIVE={
  enabled:false, valuesLive:false, inflight:false, armed:false, source:'agent', linkVia:'modbus', configOk:false, pauseTwin:false,
  cfg:{base:'http://127.0.0.1:57418', user:'Administrator', pass:'', iot:'',
       ch:'CH_FWT01', dev:'CDU_01'},
  target:{mode:'provision', ch:'CH_FWT01', dev:'CDU_01'},
  st:{about:null, channels:[], lastErr:null, tagMap:{}, values:{}, failCount:0, tagTotal:0},
};

/* ---------------- HTTP core ---------------- */
function join(base,path){return base.replace(/\/+$/,'')+path;}
LIVE.call=async function(path,{method='GET',body=null,timeout=6500,iot=false}={}){
  const base=iot?(LIVE.cfg.iot||LIVE.cfg.base):LIVE.cfg.base;
  const url=join(base,path);
  const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),timeout);
  const t0=performance.now();
  try{
    const headers={'Content-Type':'application/json'};
    if(!iot||LIVE.cfg.user) headers['Authorization']='Basic '+btoa(LIVE.cfg.user+':'+LIVE.cfg.pass);
    const r=await fetch(url,{method,headers,body:body!=null?JSON.stringify(body):null,signal:ctl.signal});
    clearTimeout(tm);
    let data=null;try{data=await r.json();}catch(e){}
    return {ok:r.ok,status:r.status,data,ms:Math.round(performance.now()-t0),
            projectId:r.headers.get('Project_ID'),url};
  }catch(e){clearTimeout(tm);
    const aborted=e.name==='AbortError';
    return {ok:false,status:0,data:null,ms:Math.round(performance.now()-t0),url,
            err:aborted?'timeout':'network',
            errDetail:aborted?`No response in ${timeout} ms`:String(e)};
  }
};
LIVE.diagnose=function(r){
  if(r.status===401)return 'Authentication rejected (401) — check user/password (server User Manager; account locks 10 min after 10 failures).';
  if(r.status===404)return `Endpoint not found (404) at ${r.url} — is this the Configuration API port? (TOP Server default HTTPS 57418; enable via Administration tray → Settings → Configuration API).`;
  if(r.status===403)return 'Forbidden (403) — CORS origin not allowed. Add "*" (or this origin) to CORS Allowed Origins in the Configuration API settings, then restart the runtime.';
  if(r.err==='timeout')return 'No response — service unreachable. Verify the Configuration API is ENABLED (Administration tray icon → Settings → Configuration API → Enable = Yes) and the port matches.';
  if(r.err==='network')return 'Browser blocked the request (network/CORS/TLS). Most common causes: ① CORS Allowed Origins not set on the server (set to *), ② self-signed HTTPS certificate not trusted — open the API URL once in a browser tab and accept/trust it, or enable the HTTP endpoint, ③ wrong port. If the server cannot be changed, use the CORS bridge (button below).';
  return `HTTP ${r.status} — ${JSON.stringify(r.data)||'unexpected response'}`;
};

/* ---------------- tag naming & payloads (SPL → Kepware) ---------------- */
function sanitize(s){return String(s).replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,44);}
LIVE.tagName=function(p,i){
  const vn=(p.vendorNames&&p.vendorNames[i]&&p.vendorNames[i].trim())||'';
  const lab=sanitize(vn||((p.addrs.length>1?p.name+'_'+(i+1):p.name)));
  return `${p.id}_${lab}`;
};
function dtypeOf(p){ if((p.regType||'').toLowerCase().includes('bool'))return 1;      // Boolean
  return (p.signed==='Signed')?4:5; }                                                // Short / Word
LIVE.buildTagMap=function(){
  const map={};let total=0;
  DB.points.forEach(p=>{ if(!p.addrs||!p.addrs.length)return;
    map[p.id]=p.addrs.map((a,i)=>LIVE.tagName(p,i));total+=p.addrs.length;});
  LIVE.st.tagMap=map;LIVE.st.tagTotal=total;return map;
};
LIVE.tagPayloads=function(){
  const out=[];
  DB.points.forEach(p=>{ if(!p.addrs||!p.addrs.length)return;
    p.addrs.forEach((a,i)=>out.push({
      'common.ALLTYPES_NAME':LIVE.tagName(p,i),
      'common.ALLTYPES_DESCRIPTION':`${p.name} [Equinix SPL 1.0 ${p.id}]${p.units&&p.units!=='N/A'?' · '+p.units:''}${p.gain&&p.gain!==1?' · gain '+p.gain:''}`,
      'servermain.TAG_ADDRESS':String(a),
      'servermain.TAG_DATA_TYPE':dtypeOf(p),
      'servermain.TAG_READ_WRITE_ACCESS':p.rw==='RW'?1:0,
      'servermain.TAG_SCAN_RATE_MILLISECONDS':1000}));});
  return out;
};

/* ---------------- Config API operations ---------------- */
LIVE.about=async function(){const r=await LIVE.call('/config/v1/about');
  if(r.ok)LIVE.st.about=r.data;return r;};
LIVE.channels=async function(){const r=await LIVE.call('/config/v1/project/channels');
  if(r.ok)LIVE.st.channels=r.data||[];return r;};
LIVE.devices=ch=>LIVE.call(`/config/v1/project/channels/${encodeURIComponent(ch)}/devices`);
LIVE.tags=(ch,dev)=>LIVE.call(`/config/v1/project/channels/${encodeURIComponent(ch)}/devices/${encodeURIComponent(dev)}/tags`);

LIVE.provision=async function(ip,unit,log){
  const ch=LIVE.target.ch,dev=LIVE.target.dev,S={chCreated:0,devCreated:0,created:0,existing:0,failed:0,detail:[]};
  // channel
  const chs=await LIVE.channels();if(!chs.ok)throw chs;
  const chExists=(chs.data||[]).some(c=>c['common.ALLTYPES_NAME']===ch);
  if(!chExists){
    const r=await LIVE.call('/config/v1/project/channels',{method:'POST',body:{
      'common.ALLTYPES_NAME':ch,'servermain.MULTIPLE_TYPES_DEVICE_DRIVER':'Modbus TCP/IP Ethernet'}});
    if(r.status===201)S.chCreated=1;else if(!/exists/i.test(JSON.stringify(r.data)))throw r;
  }
  log&&log(`channel ${ch} ${chExists?'exists ✓':'created (201) ✓'}`);
  // device
  const devs=await LIVE.devices(ch);if(!devs.ok)throw devs;
  const devExists=(devs.data||[]).some(d=>d['common.ALLTYPES_NAME']===dev);
  if(!devExists){
    const r=await LIVE.call(`/config/v1/project/channels/${encodeURIComponent(ch)}/devices`,{method:'POST',body:{
      'common.ALLTYPES_NAME':dev,'servermain.MULTIPLE_TYPES_DEVICE_DRIVER':'Modbus TCP/IP Ethernet',
      'servermain.DEVICE_ID_STRING':`${ip}.${unit}`,'servermain.DEVICE_MODEL':0}});
    if(r.status===201)S.devCreated=1;else if(!/exists/i.test(JSON.stringify(r.data)))throw r;
  }
  log&&log(`device ${dev} [ID ${ip}.${unit}] ${devExists?'exists ✓':'created (201) ✓'}`);
  // bulk tags (207 partial-status tolerated: "already exists" counts as existing)
  const payloads=LIVE.tagPayloads();
  const r=await LIVE.call(`/config/v1/project/channels/${encodeURIComponent(ch)}/devices/${encodeURIComponent(dev)}/tags`,
    {method:'POST',body:payloads,timeout:15000});
  if(r.status===201){S.created=payloads.length;}
  else if(r.status===207&&Array.isArray(r.data)){
    r.data.forEach((it,i)=>{ if(it.code===201)S.created++;
      else if(/exists/i.test(it.message||''))S.existing++;
      else {S.failed++;S.detail.push(`${payloads[i]['common.ALLTYPES_NAME']}: ${it.message}`);}});
  } else if(!r.ok) throw r;
  log&&log(`tags: ${S.created} created · ${S.existing} already present · ${S.failed} failed (bulk POST${r.status===207?' → 207 Multi-Status':''})`);
  return S;
};

/* ---------------- live values (IoT-Gateway-style) ---------------- */
LIVE.iotProbe=async function(){
  if(!LIVE.cfg.iot)return {ok:false,skipped:true};
  const map=LIVE.buildTagMap();
  const first=`${LIVE.target.ch}.${LIVE.target.dev}.${map.P02?map.P02[0]:Object.values(map)[0][0]}`;
  const r=await LIVE.call(`/iotgateway/read?ids=${encodeURIComponent(first)}`,{iot:true});
  return {ok:!!(r.ok&&r.data&&r.data.readResults),raw:r};
};
LIVE.agentProbe=async function(){
  const r=await W1AGENT.readDevice({template:window.W1_ACTIVE_TEMPLATE.id,rev:(window.W1_ACTIVE_TEMPLATE.registry.revId||''),
    ip:SIM.cfg.ip,port:SIM.cfg.port,unit:SIM.cfg.unit});
  return {ok:!!(r.ok&&r.data&&r.data.ok),raw:r};
};
LIVE.pollOnce=async function(){
  if(LIVE.inflight)return;
  if(LIVE._skip>0){LIVE._skip--;return;}  // link lost → retry every ~5 s, not every tick
  LIVE.inflight=true;
  try{
    if(LIVE.source==='agent'){
      const r=await W1AGENT.readDevice({template:window.W1_ACTIVE_TEMPLATE.id,rev:(window.W1_ACTIVE_TEMPLATE.registry.revId||''),
        ip:SIM.cfg.ip,port:SIM.cfg.port,unit:SIM.cfg.unit});
      if(!(r.ok&&r.data&&r.data.ok))throw r;
      const vals={};
      DB.points.forEach(p=>{ if(!p.addrs||!p.addrs.length)return;
        const o={raws:[],ok:[],reasons:[],ts:r.data.t};
        p.addrs.forEach((a,i)=>{let v=r.data.values[String(a)];const okv=v!=null;
          if(okv&&p.signed==='Signed'&&v>32767)v-=65536;
          o.raws[i]=okv?v:null;o.ok[i]=okv;o.reasons[i]=okv?'':'no data';});
        vals[p.id]=o;});
      LIVE.st.values=vals;
      if(LIVE.st.failCount>0||LIVE._lostToast){const lc=document.getElementById('linkChip'),lt=document.getElementById('linkTxt');
        if(lc){lc.className='chip ok';lt.textContent='LINK · GOOD (192)';}LIVE._lostToast=0;}
      LIVE.st.failCount=0;LIVE._skip=0;LIVE.inflight=false;return;
    }
    const map=LIVE.st.tagMap;const ids=[];const index=[];
    for(const pid in map)map[pid].forEach((tn,i)=>{ids.push(`${LIVE.target.ch}.${LIVE.target.dev}.${tn}`);index.push([pid,i]);});
    const q=ids.map(i=>'ids='+encodeURIComponent(i)).join('&');
    const r=await LIVE.call('/iotgateway/read?'+q,{iot:true});
    if(!(r.ok&&r.data&&r.data.readResults))throw r;
    const vals={};
    r.data.readResults.forEach((rr,k)=>{
      const [pid,i]=index[k];
      (vals[pid]=vals[pid]||{raws:[],ok:[],reasons:[],ts:rr.t}).raws[i]=rr.v;
      vals[pid].ok[i]=rr.s;vals[pid].reasons[i]=rr.r;});
    LIVE.st.values=vals;LIVE.st.failCount=0;
  }catch(e){
    LIVE.st.failCount++;if(LIVE.st.failCount>=2){if(!LIVE._skip)LIVE._skip=4;
      const lc=document.getElementById('linkChip'),lt=document.getElementById('linkTxt');
      if(lc){lc.className='chip bad';lt.textContent='LINK · LOST — RETRYING';}
      if(!LIVE._lostToast){LIVE._lostToast=1;try{toast('⚠ Link lost — retrying every ~5 s (device off? cable?)','warn',4200);}catch(e){}}}
    if(LIVE.st.failCount===3)
      window.UI&&UI.log('⚠ Live reads failing — LINK LOST. Holding last values, retrying every ~5 s (session stays LIVE)','warn');
  }finally{LIVE.inflight=false;}
};
const DECOF=g=>g===0.1?1:(g===0.01?2:0);
LIVE.install=function(){
  if(SIM._readSim)return;
  SIM._readSim=SIM.read.bind(SIM);
  SIM.read=function(id){
    const p=DB.points.find(x=>x.id===id);
    const lv=(LIVE.valuesLive&&!LIVE.pauseTwin)?LIVE.st.values[id]:null;
    if(!lv||!p||!p.addrs||!p.addrs.length)return SIM._readSim(id);
    const g=p.gain||1,dec=DECOF(g);
    const allBad=lv.ok.every(o=>!o);
    if(allBad)return {id,vals:null,raws:null,dec,
      q:{code:24,txt:'BAD ('+(lv.reasons.find(x=>x)||'no data')+')'},txt:'—',stale:true};
    const vals=lv.raws.map(r2=>(r2==null?0:r2)*g);
    const isBin=(p.regType||'').toLowerCase().includes('bool');
    let txt,alarm=false;
    if(id==='P02'){txt=`${lv.raws[0]} · ${(SIM.unitStates[lv.raws[0]]||'?').toUpperCase()}`;}
    else if(id==='P25'){txt=vals.map(v=>v?'FLT':'OK').join('/');alarm=vals.some(v=>v);}
    else if(isBin){txt=vals.map(v=>v?'ALARM':'NORM').join(' / ');alarm=vals.some(v=>v);}
    else txt=vals.map(v=>v.toFixed(dec)).join(' / ');
    return {id,vals,raws:lv.raws,dec,q:{code:192,txt:'GOOD (192) · LIVE'},txt,alarm,live:true};
  };
};
LIVE.applyToTwin=function(){
  if(!LIVE.valuesLive)return;const V=LIVE.st.values,s=SIM.st;
  const gv=(id,i=0)=>{const p=DB.points.find(x=>x.id===id);const lv=V[id];
    if(!lv||lv.raws[i]==null||!lv.ok[i])return null;return lv.raws[i]*(p.gain||1);};
  const set=(id,fn)=>{const v=gv(id);if(v!=null)fn(v);};
  set('P08',v=>s.T2=v);set('P09',v=>s.T4=v);set('P06',v=>s.T1=v);set('P07',v=>s.T5=v);
  set('P15',v=>s.secFlow=v);set('P14',v=>s.priFlow=v);
  set('P12',v=>s.PS2=v);set('P13',v=>s.PS1=v);set('P10',v=>s.PS3=v);set('P11',v=>s.PS4=v);
  set('P04',v=>s.sp=v);
  for(let i=0;i<3;i++){const v=gv('P03',i);if(v!=null){s.pumps[i].act=v;s.pumps[i].run=v>2;}
    const f=gv('P25',i);if(f!=null)s.pumps[i].fault=!!f;}
  for(let i=0;i<2;i++){const v=gv('P05',i);if(v!=null)s.valvePos[i]=v;
    const c=gv('P23',i);if(c!=null)s.valveCmd[i]=Math.round(c);}
  const st2=gv('P02');if(st2!=null){s.status=st2;s.unitOn=st2===5;}
  const leak=gv('P24');if(leak!=null)s.faults.leak=!!leak;
  const c1=gv('P19',0),c2=gv('P19',1);
  if(c1!=null)s.alarms.critical=!!c1;if(c2!=null)s.alarms.nonCritical=!!c2;
};
LIVE.write=async function(pointId,scaledVal){
  const p=DB.points.find(x=>x.id===pointId);const g=p.gain||1;
  const raw=Math.round(scaledVal/g);
  if(LIVE.source==='agent'){
    const r=await W1AGENT.writeReg({ip:SIM.cfg.ip,port:SIM.cfg.port,unit:SIM.cfg.unit,
      addr:p.addrs[0],value:raw});
    return {ok:!!r.ok,raw,detail:r};
  }
  const id=`${LIVE.target.ch}.${LIVE.target.dev}.${LIVE.st.tagMap[pointId][0]}`;
  const r=await LIVE.call('/iotgateway/write',{method:'POST',iot:true,body:[{id,v:raw}]});
  const ok=!!(r.ok&&r.data&&r.data.writeResults&&r.data.writeResults[0]&&r.data.writeResults[0].s);
  return {ok,raw,detail:r};
};

/* ---------------- CORS bridge script (downloadable) ---------------- */
LIVE.bridgePy=function(){return `#!/usr/bin/env python3
# WitnessONE CORS bridge - forwards browser calls to a locked-down TOP Server. MG
# Usage: python3 witnessone_bridge.py --api https://127.0.0.1:57418 [--iot https://127.0.0.1:39320] [--port 5711]
# Then set WitnessONE API URL to http://127.0.0.1:5711  (bridge adds CORS *, accepts self-signed TLS)
import argparse,ssl,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ap=argparse.ArgumentParser();ap.add_argument('--api',required=True);ap.add_argument('--iot',default=None);ap.add_argument('--port',type=int,default=5711)
A=ap.parse_args();CTX=ssl.create_default_context();CTX.check_hostname=False;CTX.verify_mode=ssl.CERT_NONE
class H(BaseHTTPRequestHandler):
    def _c(s):s.send_header('Access-Control-Allow-Origin','*');s.send_header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');s.send_header('Access-Control-Allow-Headers','Authorization,Content-Type')
    def do_OPTIONS(s):s.send_response(204);s._c();s.end_headers()
    def _fwd(s):
        base=A.iot if (s.path.startswith('/iotgateway') and A.iot) else A.api
        n=int(s.headers.get('Content-Length') or 0);body=s.rfile.read(n) if n else None
        rq=urllib.request.Request(base.rstrip('/')+s.path,data=body,method=s.command)
        for h in('Authorization','Content-Type'):
            if s.headers.get(h):rq.add_header(h,s.headers[h])
        try:
            with urllib.request.urlopen(rq,context=CTX,timeout=10) as r:d=r.read();code=r.status;pid=r.headers.get('Project_ID')
        except urllib.error.HTTPError as e:d=e.read();code=e.code;pid=None
        except Exception as e:d=str(e).encode();code=502;pid=None
        s.send_response(code);s._c()
        if pid:s.send_header('Project_ID',pid)
        s.send_header('Content-Type','application/json');s.send_header('Content-Length',str(len(d)));s.end_headers();s.wfile.write(d)
    do_GET=do_POST=do_PUT=do_DELETE=_fwd
print(f'WitnessONE bridge on http://127.0.0.1:{A.port} -> {A.api}'+(f' / iot -> {A.iot}' if A.iot else ''))
ThreadingHTTPServer(('127.0.0.1',A.port),H).serve_forever()
`;};
})();
</script>
