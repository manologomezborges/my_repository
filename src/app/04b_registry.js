<script>
/* ============ WitnessONE device-template registry client + Agent link ============
   Sources, in order of preference:
     agent    → WitnessONE Agent on this laptop (serves templates, syncs with the
                central registry DB when a --remote URL is configured)
     embedded → templates baked into this field-edition file at build time
   Sync model (matches the central-DB workflow): PULL updated make/model/fw/SPL,
   PUSH a proposed commit when the field finds a change, or just VERIFY (touch
   the last-checked date when everything matches).  MG */
(function(){
const AGENT=window.W1AGENT={url:'http://127.0.0.1:5710',present:false,info:null};
if(location.protocol==='http:'&&(location.hostname==='127.0.0.1'||location.hostname==='localhost'))
  AGENT.url=location.origin;   // single-exe app mode: UI is served by the agent itself
window.W1_SPLFMT=function(sv){sv=String(sv||'SPL');if(/^\d/.test(sv))sv='SPL v'+sv;return sv;};
const REG=window.REGISTRY={source:'embedded',templates:[]};

async function afetch(path,opts={},timeout=1200){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(AGENT.url+path,{...opts,signal:c.signal});clearTimeout(t);
    return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)};}
  catch(e){clearTimeout(t);return {ok:false,status:0,err:String(e)};}
}
REG.detectAgent=async function(){
  const r=await afetch('/agent/status',{},800);
  AGENT.present=!!(r.ok&&r.data&&r.data.agent==='witnessone');
  AGENT.info=AGENT.present?r.data:null;
  return AGENT.present;
};
/* ---- v2 model: DEVICES (identity) + POINTS-LIST REVISIONS (selectable SPL) ----
   The SPL is a first-class artifact: one device can be witnessed against
   v4.17, v4.18 … or SPL 1.0. Field changes NEVER touch an approved revision —
   they fork a FIELD DRAFT revision that syncs to the central DB for approval. */
const devSort=(a,b)=>(a.id==='vertiv-xdu1350b-cdu'?0:1)-(b.id==='vertiv-xdu1350b-cdu'?0:1)
  ||String(a.identity.make).localeCompare(String(b.identity.make));
function fromV1(tpls){ // accept legacy agent payloads (one welded-in SPL)
  const devices=[],lists={};
  tpls.forEach(t=>{const rid=String(t.registry.splVersion||'spl').toLowerCase().replace(/[^a-z0-9.]+/g,'-');
    devices.push({schema:'witnessone.device/2',id:t.id,class:t.class,identity:t.identity,
      layout:t.layout,fwtScript:t.fwtScript,defaultPointsList:rid,
      registry:{version:t.registry.version,lastVerified:t.registry.lastVerified,
        verifiedBy:t.registry.verifiedBy,source:t.registry.source,complianceStatus:t.registry.complianceStatus}});
    lists[t.id]=[{schema:'witnessone.pointslist/2',revId:rid,device:t.id,splVersion:t.registry.splVersion,
      status:'approved',appliesToFw:t.identity.firmwares||[],basedOn:null,
      approvedBy:t.registry.verifiedBy,approvedDate:t.registry.lastVerified,spl:t.spl}];});
  return {devices,lists};
}
function adopt(devices,lists){
  REG.devices=devices.slice().sort(devSort);REG.lists=lists;
  REG.templates=REG.devices.map(d=>synth(d,REG.defaultRev(d.id))); // legacy view for callers
  return REG.templates;
}
function synth(d,rev){return {schema:'witnessone.device-template/1',id:d.id,class:d.class,
  identity:d.identity,layout:d.layout,fwtScript:d.fwtScript,
  registry:Object.assign({},d.registry,{splVersion:rev.splVersion,revId:rev.revId,revStatus:rev.status}),
  spl:rev.spl};}
REG.defaultRev=function(id){const d=REG.devices.find(x=>x.id===id);const rl=REG.lists[id]||[];
  return rl.find(r=>r.revId===(d&&d.defaultPointsList))||rl[0];};
REG.revisions=function(id,fwv){const rl=(REG.lists&&REG.lists[id])||[];
  return rl.filter(r=>!fwv||!(r.appliesToFw&&r.appliesToFw.length)||r.appliesToFw.includes(fwv)
    ||r.status!=='approved');}; // drafts always offered
REG.load=async function(){
  if(AGENT.present){
    const r=await afetch('/registry/devices',{},2500);
    if(r.ok&&r.data&&r.data.devices&&r.data.devices.length){
      REG.source='agent';return adopt(r.data.devices,r.data.pointslists||{});}
    if(r.ok&&r.data&&r.data.templates&&r.data.templates.length){ // old agent
      const v=fromV1(r.data.templates);REG.source='agent';return adopt(v.devices,v.lists);}
  }
  const E=window.W1_REGISTRY_EMBEDDED;REG.source='embedded';
  if(E.devices)return adopt(E.devices,E.pointslists);
  const v=fromV1(E.templates);return adopt(v.devices,v.lists);
};
REG.get=id=>REG.templates.find(t=>t.id===id);
REG.setActive=function(id,revId){
  const d=(REG.devices||[]).find(x=>x.id===id);if(!d)return null;
  const rev=(revId&&(REG.lists[id]||[]).find(r=>r.revId===revId))||REG.activeRevFor(id)||REG.defaultRev(id);
  const t=synth(d,rev);
  REG.activeDev=d;REG.activeRev=rev;
  window.W1_ACTIVE_TEMPLATE=t;
  const db=window.SPL_DB;
  if(db){
    // Working copy: mutate the canonical shared object every module captured at
    // load. Revision stores stay pristine — field adds live only in the working
    // copy until saved into a DRAFT revision.
    const src=rev.spl.points.slice(); // snapshot first — rev store may alias db on first load
    db.points.length=0;src.forEach(p=>db.points.push(p));
    db.meta=rev.spl.meta;db.stateTables=rev.spl.stateTables;db.revlog=rev.spl.revlog;
    t.spl=db;
  } else window.SPL_DB=t.spl;
  const i=REG.templates.findIndex(x=>x.id===id);if(i>=0)REG.templates[i]=t;
  return t;};
REG.activeRevFor=id=>(REG.activeDev&&REG.activeDev.id===id)?REG.activeRev:null;
REG.forkDraft=function(id){
  const cur=REG.activeRevFor(id)||REG.defaultRev(id);
  const date=new Date().toISOString().slice(0,10);
  const nr={schema:'witnessone.pointslist/2',revId:cur.revId+'-fld-'+date.replace(/-/g,''),
    device:id,splVersion:cur.splVersion+' + field '+date,status:'field-draft',
    appliesToFw:cur.appliesToFw,basedOn:cur.revId,approvedBy:null,approvedDate:null,
    spl:{meta:cur.spl.meta,revlog:cur.spl.revlog,stateTables:cur.spl.stateTables,
         points:window.SPL_DB.points.slice()}};
  const ex=(REG.lists[id]=REG.lists[id]||[]).find(r=>r.revId===nr.revId);
  if(ex)return REG.setActive(id,ex.revId)&&ex;
  REG.lists[id].push(nr);
  REG.setActive(id,nr.revId);
  return nr;};
REG.snapshotDraft=function(id){ // pull the working copy back into the active draft revision
  const rev=REG.activeRevFor(id);if(!rev||rev.status!=='field-draft')return null;
  rev.spl={meta:window.SPL_DB.meta,revlog:window.SPL_DB.revlog,
    stateTables:window.SPL_DB.stateTables,points:window.SPL_DB.points.slice()};
  return rev;};
REG.saveDraft=async function(id){
  const rev=REG.snapshotDraft(id);
  if(!rev)return{ok:false,msg:'active points list is not a field draft'};
  if(!AGENT.present)return{ok:false,msg:'WitnessONE Agent required to save the draft revision'};
  const r=await afetch(`/registry/devices/${id}/pointslists`,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({rev})},6000);
  return r.data||{ok:false,msg:'agent error'};
};
REG.verify=async function(id,by='MG'){
  if(!AGENT.present)return{ok:false,msg:'WitnessONE Agent required to record verification'};
  const r=await afetch(`/registry/devices/${id}/verify`,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({by})},4000);
  return r.data||{ok:false,msg:'agent error'};
};
REG.propose=async function(id,note,by='MG',template=null){
  if(!AGENT.present)return{ok:false,msg:'WitnessONE Agent required to queue a commit'};
  const rev=REG.activeRevFor(id);
  const r=await afetch(`/registry/devices/${id}/propose`,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({by,note,template,revId:rev?rev.revId:null,
      rev:(rev&&rev.status==='field-draft')?REG.snapshotDraft(id):null})},6000);
  return r.data||{ok:false,msg:'agent error'};
};
REG.sync=async function(){
  if(!AGENT.present)return{ok:false,msg:'WitnessONE Agent required'};
  const r=await afetch('/registry/sync',{method:'POST'},8000);
  return r.data||{ok:false,msg:'agent error'};
};

/* ---- agent-powered device I/O ---- */
AGENT.discover=async function(body){const r=await afetch('/modbus/discover',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},9000);
  return r.data||{results:[],error:r.err||r.status};};
AGENT.scan=async function(body){const r=await afetch('/modbus/scan',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},45000);
  return r.data||{ok:false,error:r.err||r.status};};
AGENT.readDevice=async function(q){const r=await afetch('/modbus/read?'+new URLSearchParams(q),{},3500);
  return r;};
AGENT.ping=async function(body){const r=await afetch('/net/ping',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},7000);
  return r.data||{ok:false,error:r.err||('HTTP '+r.status)};};
AGENT.probe=async function(body){const r=await afetch('/modbus/probe',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},6000);
  return r.data||{ok:false,error:r.err||('HTTP '+r.status)};};
AGENT.writeReg=async function(body){const r=await afetch('/modbus/write',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},4000);
  return r.data||{ok:false};};
AGENT.setPhase=async function(phase){return afetch('/agent/phase',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({phase})},1500);};
AGENT.status=async function(){const r=await afetch('/agent/status',{},1200);return r.ok?r.data:null;};
AGENT.saveRun=async function(run){const r=await afetch('/records/runs',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(run)},4000);
  return r.data||{ok:false};};
})();
</script>
