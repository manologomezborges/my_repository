<script>
/* ============ WitnessONE boot: registry-driven library, discovery, SIM/LIVE connect ============
   Catalog comes from the template REGISTRY (agent → central DB when configured,
   embedded field edition otherwise). Discovery is REAL Modbus TCP when the
   WitnessONE Agent is running; theatrical simulation otherwise.  MG */
(function(){
const $=id=>document.getElementById(id);
const SOON_MAKES=['MOTIVAIR','BOYD','COOLIT','NVENT','STULZ'];
const SOON_MODELS={'VERTIV':['XDU070 (in-rack)','XDU600','CoolChip CDU 2300']};

/* ---------- registry-driven catalog ---------- */
function fillCatalog(){
  const mk=$('make'),md=$('model'),fw=$('fw');
  const tpls=REGISTRY.templates||[];
  const makes={};tpls.forEach(t=>{(makes[t.identity.make]=makes[t.identity.make]||[]).push(t);});
  mk.innerHTML='';
  Object.keys(makes).forEach(k=>{const o=document.createElement('option');o.value=k;o.textContent=k;mk.appendChild(o);});
  SOON_MAKES.forEach(k=>{const o=document.createElement('option');o.value=k;
    o.textContent=k+'  — template coming soon';o.disabled=true;mk.appendChild(o);});
  const fillModels=()=>{md.innerHTML='';
    (makes[mk.value]||[]).forEach(t=>{const o=document.createElement('option');o.value=t.id;
      o.textContent=t.identity.model;md.appendChild(o);});
    (SOON_MODELS[mk.value]||[]).forEach(m=>{const o=document.createElement('option');
      o.textContent=m+'  — pending';o.disabled=true;md.appendChild(o);});
    fillFw();};
  const splLabel=r=>{const sv=W1_SPLFMT(r.splVersion);
    const nm=(sv.toUpperCase().startsWith('EQX')||/vendor|field/i.test(sv)?sv:'Equinix '+sv);
    return nm+' ('+(r.status==='approved'?'Approved':r.status==='field-draft'?'FIELD DRAFT — pending approval':r.status)+')';};
  const fillSpl=()=>{const t=REGISTRY.get(md.value);if(!t)return;
    const revs=REGISTRY.revisions(t.id,fw.value);
    const sel=$('tpl');sel.innerHTML='';
    revs.forEach(r=>{const o=document.createElement('option');o.value=r.revId;
      o.textContent=splLabel(r);sel.appendChild(o);});
    const act=REGISTRY.activeRevFor(t.id);
    const pick=(act&&revs.find(r=>r.revId===act.revId))||revs.find(r=>r.status==='approved')||revs[0];
    if(pick){sel.value=pick.revId;REGISTRY.setActive(t.id,pick.revId);}
    const fp=window.SPL_DB.points.find(p=>p.addrs&&p.addrs.length);
    const mb=$('mbAddr');if(fp&&mb)mb.value=fp.addrs[0];};
  window.W1_FILLSPL=fillSpl;
  const fillFw=()=>{fw.innerHTML='';const t=REGISTRY.get(md.value);
    if(t){REGISTRY.setActive(t.id);
      t.identity.firmwares.forEach((v,i)=>{const o=document.createElement('option');o.value=v;
        o.textContent=v+(i===0?'  (latest approved)':'');fw.appendChild(o);});
      fillSpl();}};
  mk.onchange=fillModels;md.onchange=fillFw;fw.onchange=fillSpl;
  $('tpl').onchange=()=>{const t=REGISTRY.get(md.value);if(!t)return;
    REGISTRY.setActive(t.id,$('tpl').value);
    const r=REGISTRY.activeRev;
    toast('Points list → '+splLabel(r)+' · '+window.SPL_DB.points.length+' points','',2600);};
  if(Object.keys(makes).length)mk.value=Object.keys(makes)[0];
  fillModels();
}
function updAgentChip(){const el=$('agentChip');if(!el)return;
  if(W1AGENT.present){el.className='chip ok';
    el.innerHTML=`<span class="dot"></span>AGENT v${W1AGENT.info.version} · ${W1AGENT.info.records} RECORDS${W1AGENT.info.remoteRegistry?' · DB SYNC':''}`;}
  else{el.className='chip';el.innerHTML='<span class="dot"></span>AGENT · NOT RUNNING';
    el.title='Run witnessone_agent.py for real Modbus discovery, direct live values, registry sync and test records';}}

/* ---------- device library modal ---------- */
function renderLibrary(){
  $('libSrc').className='chip '+(REGISTRY.source==='agent'?'ok':'warn');
  $('libSrc').innerHTML=`<span class="dot"></span>SOURCE · ${REGISTRY.source.toUpperCase()}${REGISTRY.source==='agent'&&W1AGENT.info&&W1AGENT.info.remoteRegistry?' + CENTRAL DB':''}`;
  const host=$('libList');host.innerHTML='';
  REGISTRY.templates.forEach(t=>{
    const d=document.createElement('div');d.className='tstep';d.style.marginBottom='8px';
    d.innerHTML=`<div class="hd" style="cursor:default">
      <div class="ti"><div class="nm">${t.identity.make} ${t.identity.model} <span class="badge ok">${t.class}</span> <span class="badge r">v${t.registry.version}</span></div>
      <div class="ds">fw ${t.identity.firmwares.join(' · ')} · ${t.spl.points.length} points · ${t.registry.complianceStatus}</div>
      <div class="ds">points lists: ${((REGISTRY.lists||{})[t.id]||[]).map(r=>`<span class="badge ${r.status==='approved'?'ok':'r'}" title="${r.status}">${r.splVersion}${r.status==='field-draft'?' ✎':''}</span>`).join(' ')||t.registry.splVersion}</div>
      <div class="ds">last verified <b style="color:var(--acc2)">${t.registry.lastVerified}</b> by ${t.registry.verifiedBy}</div></div>
      <div style="display:flex;gap:6px;flex-direction:column">
        <button class="btn ghost small" data-v="${t.id}">✓ Mark verified</button>
        <button class="btn ghost small" data-p="${t.id}">⇪ Propose commit</button></div></div>`;
    host.appendChild(d);});
  ['MOTIVAIR CDU','BOYD CDU','COOLIT CHx1000','NVENT CDU'].forEach(n=>{
    const d=document.createElement('div');d.className='tstep';d.style.opacity=.45;d.style.marginBottom='8px';
    d.innerHTML=`<div class="hd" style="cursor:default"><div class="ti"><div class="nm">${n}</div>
      <div class="ds">template pending — a registry Sync will deliver it once published to the central DB</div></div></div>`;
    host.appendChild(d);});
  host.querySelectorAll('[data-v]').forEach(b=>b.onclick=async()=>{
    const r=await REGISTRY.verify(b.dataset.v);
    if(r.ok){toast(`✓ Verified today ${r.pushed?'· pushed to central DB':'· recorded on agent (no remote DB configured)'}`,'good');
      await REGISTRY.load();renderLibrary();fillCatalog();}
    else toast(r.msg||'verify failed','warn');});
  host.querySelectorAll('[data-p]').forEach(b=>b.onclick=async()=>{
    const note=prompt('Describe the change found in the field (this becomes the commit note):',
      'Firmware 1.0b20 observed on unit — SPL alignment check needed');
    if(note==null)return;
    const r=await REGISTRY.propose(b.dataset.p,note);
    if(r.ok)toast(`⇪ Commit ${r.pushed?'pushed to central DB':'queued on agent ('+(r.file||'pending')+')'}`,'good');
    else toast(r.msg||'propose failed','warn');});
}
async function libSync(){
  const r=await REGISTRY.sync();
  if(r.ok){toast(`⇅ Registry sync — ${r.pulled} template(s) pulled`,'good');
    await REGISTRY.load();renderLibrary();fillCatalog();}
  else toast(r.msg||'sync failed','warn',4200);
}

/* ---------- typewriter ---------- */
function typer(el,lines,onDone,gap=140){
  let i=0;el.innerHTML='';
  const cur=document.createElement('span');cur.className='cursor';
  const next=()=>{
    if(i>=lines.length){cur.remove();onDone&&onDone();return;}
    const [txt,cls,delay]=lines[i];i++;
    const d=document.createElement('div');if(cls)d.className=cls;d.innerHTML=txt;
    el.appendChild(d);el.appendChild(cur);el.scrollTop=1e6;
    setTimeout(next,delay??gap);
  };next();
}

/* ---------- discovery = REGISTER-RANGE SWEEP at the KNOWN device IP ----------
   (You always know the IP. Discovery walks the Modbus address space gently and
   overlays the result on the SPL template: responding / silent / NEW registers.) */
function showMatch(r){
  $('discMake').textContent=r.match.make;$('discModel').textContent=r.match.model;
  $('discFw').textContent=r.match.fw;
  const t=REGISTRY.get(r.match.templateId);
  $('discTpl').textContent=t?`${t.registry.splVersion} — ${t.class}`:r.match.templateId;
  $('discChipTxt').textContent=`REGISTER MAP MATCHES TEMPLATE · LIVE MODBUS · ${r.ip}`;
  $('discFound').classList.remove('hidden');$('btnDiscAdopt').disabled=false;
}
async function realDiscovery(){
  $('discModal').classList.remove('hidden');$('discFound').classList.add('hidden');$('btnDiscAdopt').disabled=true;
  const el=$('discLines');el.innerHTML='';
  const add=(h,c)=>{const d=document.createElement('div');if(c)d.className=c;d.innerHTML=h;
    el.appendChild(d);el.scrollTop=1e6;return d;};
  const ip=$('ip').value.trim(),port=+($('port').value.trim())||502,unit=+($('unitId').value.trim())||1;
  add(`<span class="dim">$</span> agent modbus scan --ip ${ip} --port ${port} --unit ${unit}  <span class="dim">(REAL Modbus · read-only · gentle: 12-reg chunks, 40 ms gaps)</span>`);
  add(`Sweeping register space: input 30001-30120 · holding 40001-40050 · discrete 10001-10064 …`,'dim');
  const res=await W1AGENT.scan({ip,port,unit});
  if(!res.ok){add(`<span class="err">✕ scan failed — ${res.error||'device unreachable'}</span>`);
    add(`Check IP/port/unit and physical link, then retry.`,'dim');return;}
  const tplAddr={};window.SPL_DB.points.forEach(p=>(p.addrs||[]).forEach(a=>tplAddr[a]=p));
  const tplList=Object.keys(tplAddr).map(Number);
  const byAddr={};res.found.forEach(f=>byAddr[f.addr]=f);
  const inT=tplList.filter(a=>byAddr[a]!==undefined);
  const silent=tplList.filter(a=>byAddr[a]===undefined);
  const newCand=res.found.filter(f=>!tplAddr[f.addr]&&f.value!==0);
  add(`Probed <b>${res.probed}</b> addresses → ${res.found.length} readable · ${res.refusedChunks?res.refusedChunks+' range(s) refused (illegal address — normal)':'no refusals'}`);
  add(`Template overlay: <span class="ok">${inT.length}/${tplList.length} SPL registers responding</span>${silent.length?` · <span class="err">${silent.length} SILENT: ${silent.join(', ')}</span>`:''}`);
  if(silent.length)add(`  Silent SPL registers stay flagged in the points table (grey — / RX counter drops).`,'dim');
  if(newCand.length){
    add(`&nbsp;`);
    add(`<span style="color:var(--warn)">◆ ${newCand.length} register(s) responding that are NOT in the SPL template:</span>`);
    newCand.forEach(f=>{
      const row=add(`  <span style="color:var(--warn)">◆</span> <b>${f.addr}</b> = ${f.value}  <span class="dim">(FC0${f.fc})</span>  <span class="acc" style="cursor:pointer;text-decoration:underline">[ ＋ ADD TO TEMPLATE ]</span>`);
      row.querySelector('.acc').onclick=()=>{
        $('discModal').classList.add('hidden');
        $('regModal').classList.remove('hidden');
        $('rgAddr').value=f.addr;$('rgName').value='';$('rgGain').value='1';
        toast(`Datasheet check: what is register ${f.addr}? Fill the details and queue the commit.`,'',4200);};
    });
  } else add(`No unmapped non-zero registers in the swept ranges.`,'dim');
  const st=byAddr[30001];
  if(st&&st.value>=0&&st.value<=15&&inT.length>=tplList.length*0.8){
    add(`&nbsp;`);
    add(`Identity: 30001 Unit Status = <b>${st.value}</b> · map consistent with <span class="ok">${W1_ACTIVE_TEMPLATE.identity.make} ${W1_ACTIVE_TEMPLATE.identity.model}</span>`);
    showMatch({ip,match:{make:W1_ACTIVE_TEMPLATE.identity.make,model:W1_ACTIVE_TEMPLATE.identity.model,
      fw:W1_ACTIVE_TEMPLATE.identity.firmwares[0],templateId:W1_ACTIVE_TEMPLATE.id,
      confidence:Math.min(99,60+inT.length*1.7)}});
  }
}

/* ---------- add-register (field template update, commit queued to central DB) ---------- */
function wireAddReg(){
  $('btnAddReg').onclick=()=>$('regModal').classList.remove('hidden');
  $('btnRegClose').onclick=$('btnRegCancel').onclick=()=>$('regModal').classList.add('hidden');
  $('btnRegAdd').onclick=async()=>{
    const name=$('rgName').value.trim(),addr=parseInt($('rgAddr').value.trim(),10);
    if(!name||!addr||addr<10001||addr>49999){toast('Enter a point name and a 5-digit address (1xxxx / 3xxxx / 4xxxx)','warn');return;}
    // NEVER touch the approved list: field changes fork a FIELD DRAFT revision.
    // Fork FIRST (QA-3 fix): a same-day repeat add must land on the revision that
    // already carries today's earlier field points (forkDraft finds that existing
    // draft and switches window.SPL_DB onto it), so the duplicate-address check
    // and id generator below run against the true current point set instead of
    // the untouched approved list — otherwise both checks pass wrongly and the
    // push after fork silently duplicates the id and address.
    const devId=window.W1_ACTIVE_TEMPLATE.id;
    const wasApproved=(window.W1_ACTIVE_TEMPLATE.registry.revStatus||'approved')==='approved';
    if(wasApproved){
      const nr=REGISTRY.forkDraft(devId);
      toast(`✎ Approved list untouched — changes go to a new revision: ${nr.splVersion}`,'',4600);
      window.W1_FILLSPL&&W1_FILLSPL();
    }
    if(window.SPL_DB.points.some(p=>(p.addrs||[]).includes(addr))){toast(`Address ${addr} is already mapped in the template`,'warn');return;}
    const isB=$('rgType').value==='Boolean'||String(addr)[0]==='1';
    const usedIds=new Set(window.SPL_DB.points.map(p=>p.id));
    let n=window.SPL_DB.points.filter(x=>x.custom).length+1,newId;
    do{newId='C'+String(n++).padStart(2,'0');}while(usedIds.has(newId));
    const p={id:newId,custom:true,
      name,vendorName:name,vendorNames:[name],cls:isB?'BI':'AI',clsFlag:'A',
      addrs:[addr],addrRaw:String(addr),count:'1',bitmask:'N/A',
      regType:isB?'Boolean':'16int',signed:isB?'Discrete Input':$('rgSigned').value,
      readFC:String(addr)[0]==='1'?'02':(String(addr)[0]==='4'?'03':'04'),
      writeFC:$('rgRW').value==='RW'?'06':'N/A',rw:$('rgRW').value,
      units:$('rgUnits').value.trim()||null,
      min:isNaN(parseFloat($('rgMin').value))?null:parseFloat($('rgMin').value),
      max:isNaN(parseFloat($('rgMax').value))?null:parseFloat($('rgMax').value),
      gain:parseFloat($('rgGain').value)||1,compliance:'FieldAdded',
      stateTable:isB?'NORMAL_ALARM':null,floatStatus:null,alarmDev:null,severity:null,notifyEng:false,
      trendCOV:null,custVisible:null,
      equinixComment:'FIELD-ADDED register — pending central registry approval',
      vendorComment:'Added in the field via WitnessONE ('+new Date().toISOString().slice(0,10)+')'};
    window.SPL_DB.points.push(p);
    REGISTRY.snapshotDraft(devId);
    window.UI&&UI.rebuildPoints&&UI.rebuildPoints();
    window.UI&&UI.relabelForTemplate&&UI.relabelForTemplate();
    const pc=$('ptCount');if(pc)pc.textContent=window.SPL_DB.points.length;
    $('regModal').classList.add('hidden');
    toast(`＋ ${p.id} · ${name} @ ${addr} — live in the points table`,'good');
    if(W1AGENT.present){
      const sv=await REGISTRY.saveDraft(devId);
      const r=await REGISTRY.propose(devId,`Field-added register ${addr} (${name}) — draft revision ${REGISTRY.activeRev.revId}`,'MG',null);
      if(sv.ok&&r.ok)toast(`🗄 Draft revision saved on this laptop · commit ${r.pushed?'PUSHED to central DB':'QUEUED — pushes when the registry API is online'}`,'good',5200);
      else toast((sv.msg||r.msg)||'draft save failed','warn');
    } else toast('Agent not running — draft revision lives this session only (not saved)','warn',5200);
  };
}
function runDiscovery(){
  if(W1AGENT.present)return realDiscovery();
  $('discModal').classList.remove('hidden');$('discFound').classList.add('hidden');$('btnDiscAdopt').disabled=true;
  const ip=$('ip').value.trim()||'192.168.10.51';
  typer($('discLines'),[
    [`<span class="dim">$</span> witnessone discover --subnet ${ip.split('.').slice(0,3).join('.')}.0/24 --port 502  <span class="dim">(simulated — run the Agent for real scans)</span>`,'',260],
    [`Sweeping 254 hosts for Modbus/TCP listeners…`,'dim',700],
    [`  ${ip} <span class="ok">→ port 502 OPEN</span>  (1.9 ms)`,'',380],
    [`  FC04 read 30001 (Unit Status) → <b>5</b> · valid register map detected`,'',400],
    [`  FC04 read 30003…30005 → 61 / 60 / 0 %  (3× VSD pump signature)`,'',400],
    [`Fingerprinting against WitnessONE template registry…`,'dim',700],
    [`  match: <span class="ok">VERTIV XDU1350B</span> — confidence 98.4 %`,'',420],
    [`<span class="ok">✔ DISCOVERY COMPLETE — device identified</span>`,'',200],
  ],()=>{$('discChipTxt').textContent='DEVICE FINGERPRINT MATCHED (SIMULATED)';
    $('discFound').classList.remove('hidden');$('btnDiscAdopt').disabled=false;});
}

/* ---------- SIM/LIVE mode ---------- */
let mode='sim';
/* ---------- handshake cancel (UX-2) ----------
   hsGen is bumped on every connect attempt and on cancel; simConnect/liveConnect
   capture their own generation and stop touching the UI (or calling startApp) the
   moment it no longer matches, so a stalled ping/probe/API call left running in
   the background after Cancel can never resurface and clobber a later attempt. */
let hsGen=0;
function hsCancel(){hsGen++;window.W1_HS_ABORT=true;$('handshake').classList.add('hidden');$('boot').classList.remove('hidden');}
function setMode(m){mode=m;LIVE.enabled=(m==='live');
  $('segSim').classList.toggle('on',m==='sim');
  $('segLive').classList.toggle('on',m==='live');
  $('liveCfg').classList.toggle('hidden',m!=='live');}
function setLinkVia(v){LIVE.linkVia=v;
  $('lvModbus').classList.toggle('on',v==='modbus');
  $('lvTops').classList.toggle('on',v==='topserver');
  $('lvModbusPane').classList.toggle('hidden',v!=='modbus');
  $('lvTopsPane').classList.toggle('hidden',v!=='topserver');}
function readLiveCfg(){LIVE.cfg.base=$('apiUrl').value.trim();LIVE.cfg.user=$('apiUser').value.trim();
  LIVE.cfg.pass=$('apiPass').value;LIVE.cfg.iot=$('iotUrl').value.trim();
  LIVE.source=(LIVE.linkVia||'modbus')==='modbus'?'agent':'iot';}

async function testApi(){
  readLiveCfg();const el=$('apiStatus');el.textContent='testing…';el.style.color='var(--txt3)';
  const r=await LIVE.about();
  if(r.ok){el.textContent=`✔ ${(r.data||{}).product_name||'server'} ${(r.data||{}).product_version||''} · ${r.ms} ms`;
    el.style.color='var(--good)';$('btnExplore').disabled=false;return true;}
  el.textContent='✕ '+(r.status?('HTTP '+r.status):r.err);el.style.color='var(--crit)';
  showDoctor(r,'GET /config/v1/about');return false;
}

/* ---------- server explorer ---------- */
let explSel=null;
async function openExplorer(viewOnly=false){
  readLiveCfg();
  $('explModal').classList.remove('hidden');
  $('explModeBox').style.display=viewOnly?'none':'';
  $('btnExplOk').style.display=viewOnly?'none':'';
  await refreshExplorer();
}
async function refreshExplorer(){
  const tree=$('explTree');
  tree.innerHTML='<div style="color:var(--txt3);font:12px var(--mono);padding:10px">GET /config/v1/project/channels…</div>';
  const ab=LIVE.st.about;$('explProd').textContent=ab?`${ab.product_name||''} ${ab.product_version||''}`:'TOP Server';
  const r=await LIVE.channels();
  if(!r.ok){tree.innerHTML=`<div style="color:var(--crit);font:12px var(--mono);padding:10px">✕ ${r.status?'HTTP '+r.status:r.err} — ${LIVE.diagnose(r)}</div>`;return;}
  tree.innerHTML='';
  if(!(r.data||[]).length)tree.innerHTML='<div style="color:var(--txt3);font:12px var(--mono);padding:10px">Project is empty — use Provision below.</div>';
  for(const ch of r.data||[]){
    const name=ch['common.ALLTYPES_NAME'],drv=ch['servermain.MULTIPLE_TYPES_DEVICE_DRIVER']||'';
    const row=document.createElement('div');row.className='trow';
    row.innerHTML=`<span class="tico">📡</span><b>${name}</b><span class="tmeta">${drv}</span>`;
    tree.appendChild(row);
    const dr=await LIVE.devices(name);
    for(const dv of (dr.ok?dr.data:[])||[]){
      const dn=dv['common.ALLTYPES_NAME'],did=dv['servermain.DEVICE_ID_STRING']||'';
      const drow=document.createElement('div');drow.className='trow tindent';
      const mid=`tm_${name}_${dn}`.replace(/[^A-Za-z0-9_]/g,'');
      drow.innerHTML=`<span class="tico">🗄</span>${dn}<span class="tmeta" id="${mid}">${did}</span>`;
      drow.onclick=async()=>{
        document.querySelectorAll('#explTree .trow').forEach(t2=>t2.classList.remove('sel'));
        drow.classList.add('sel');explSel={ch:name,dev:dn};
        $('explSel').textContent=`${name}.${dn}`;$('explSel').style.color='var(--acc2)';
        const em=document.querySelector('input[name=explMode][value=existing]');if(em)em.checked=true;
        const tr=await LIVE.tags(name,dn);
        const tm=$(mid);if(tr.ok&&tm)tm.textContent=`${did} · ${(tr.data||[]).length} tags`;};
      tree.appendChild(drow);
    }
  }
}
function applyExplorer(){
  const m=(document.querySelector('input[name=explMode]:checked')||{}).value||'provision';
  if(m==='existing'&&explSel)LIVE.target={mode:'existing',ch:explSel.ch,dev:explSel.dev};
  else LIVE.target={mode:'provision',ch:'CH_FWT01',dev:'CDU_01'};
  $('explModal').classList.add('hidden');
  toast(`Target set → <b>${LIVE.target.ch}.${LIVE.target.dev}</b> (${LIVE.target.mode})`,'good');
}

/* ---------- connection doctor ---------- */
function showDoctor(r,what){
  $('docErr').textContent=`${what}\n→ ${r.url||LIVE.cfg.base}\nstatus ${r.status||0}${r.err?' · '+r.err:''}${r.errDetail?'\n'+r.errDetail:''}${r.data?'\n'+JSON.stringify(r.data).slice(0,220):''}`;
  $('docHint').textContent=LIVE.diagnose(r);
  $('doctorModal').classList.remove('hidden');}
function dlBridge(){const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([LIVE.bridgePy()],{type:'text/x-python'}));
  a.download='witnessone_bridge.py';a.click();}

/* ---------- shared app start ---------- */
function startApp(){
  $('handshake').classList.add('hidden');
  $('app').classList.remove('hidden');
  SCENE.setMode('live');
  if(SIM.rebind)SIM.rebind();
  if(SCENE.rebuild)SCENE.rebuild();
  UI.init();FWT.init();REPORT.init();
  SIM.connected=true;SIM.start();
  if(LIVE.enabled){LIVE.install();
    $('btnServer').classList.remove('hidden');
    $('btnServer').onclick=()=>openExplorer(true);}
  UI.setSourceChip&&UI.setSourceChip();
  if(LIVE.enabled)
    UI.log(`LIVE link — ${LIVE.valuesLive?(LIVE.source==='agent'?`DIRECT MODBUS ${SIM.cfg.ip}:${SIM.cfg.port}.${SIM.cfg.unit} via Agent`:'values via IoT gateway'):'values simulated'}${LIVE.configOk?` · TOP Server config ${LIVE.target.ch}.${LIVE.target.dev}`:''}`,'acc');
  else UI.log(`Channel CH_FWT01 / device ${(W1_ACTIVE_TEMPLATE.class||'DEV').replace(/\s+/g,'_')}_01 online — ${SIM.cfg.ip}:${SIM.cfg.port}.${SIM.cfg.unit} @ 1000 ms`,'acc');
  UI.log('Materializing digital twin from template geometry…','acc');
  SCENE.assemble(()=>{
    SCENE.heroCam();
    const T=window.W1_ACTIVE_TEMPLATE;
    toast(`✅ <b>Digital twin online</b> — ${T.identity.make} ${T.identity.model.length<=16?T.identity.model:T.identity.model.split(' ')[0]} · ${LIVE.valuesLive?'LIVE telemetry':window.SPL_DB.points.length+' '+T.registry.splVersion+' points'}`,'good',4200);
    UI.log('Digital twin assembled — X-Ray and component inspection available','ok');
  });
}

/* ---------- SIM connect (typed sequence) ---------- */
function simConnect(){
  const myGen=++hsGen;window.W1_HS_ABORT=false;
  const ip=$('ip').value.trim(),port=$('port').value.trim(),unit=$('unitId').value.trim(),fwv=$('fw').value;
  SIM.cfg.ip=ip;SIM.cfg.port=+port||502;SIM.cfg.unit=+unit||1;SIM.cfg.fw=fwv;
  $('devIP').textContent=`${ip}:${port}`;$('devFW').textContent='FW '+fwv;
  $('boot').classList.add('hidden');$('handshake').classList.remove('hidden');
  const bar=p=>$('hsBar').style.width=p+'%';
  const L=[
    [`<span class="dim">witnessone</span> link --target ${ip}:${port}.${unit} --template EQX-SPL1.0-CDU`,'',300],
    [`ICMP ${ip} … <span class="ok">reply 1.2 ms</span>`,'',330],
    [`TOP Server v7.1 runtime (<span class="acc">server_runtime</span>) — Configuration API session opened`,'',380],
    [`  POST /config/v1/project/channels → <span class="acc">CH_FWT01</span>  [driver: Modbus TCP/IP Ethernet]`,'',400],
    [`  POST …/channels/CH_FWT01/devices → <span class="acc">CDU_01</span>  [ID ${ip}.${unit}]`,'',400],
    [`  CSV tag import: Equinix_SPL1.0_CDU_VERTIV_XDU1350B.csv → <span class="ok">26 tags</span> (linear scaling, EU units)`,'',480],
    [`  scan rate 1000 ms · optimized blocks: FC04 ×2 · FC02 ×1 · FC03 ×1`,'dim',420],
    [`OPC UA endpoint <span class="acc">opc.tcp://localhost:49380</span> — session open (Basic256Sha256, cert trusted)`,'',460],
    [`Initial poll: 30001 Unit Status → <b>5 · ONLINE (RUNNING)</b>`,'',420],
    [`  quality: <span class="ok">24 tags GOOD (192)</span> · 2 tags N/A by design (P16, P21) · fw ${fwv} ✔`,'',430],
    [`<span class="ok">■ LINK ESTABLISHED — streaming telemetry</span>`,'',260],
  ];
  const el=$('hsLines');el.innerHTML='';
  const cur=document.createElement('span');cur.className='cursor';
  let i=0;
  const next=()=>{
    if(myGen!==hsGen){cur.remove();return;} // cancelled — don't keep animating a hidden screen
    if(i>=L.length){cur.remove();setTimeout(()=>{if(myGen===hsGen)startApp();},700);return;}
    const [txt,cls,delay]=L[i];i++;
    const d=document.createElement('div');if(cls)d.className=cls;d.innerHTML=txt;
    el.appendChild(d);el.appendChild(cur);el.scrollTop=1e6;
    bar(Math.round(i/L.length*100));
    setTimeout(next,delay??140);
  };
  $('hsStatus').textContent='NEGOTIATING';
  next();
}

/* ---------- LIVE connect (real Configuration API + chosen value source) ---------- */
function hsLine(html,cls){const d=document.createElement('div');if(cls)d.className=cls;d.innerHTML=html;
  $('hsLines').appendChild(d);$('hsLines').scrollTop=1e6;}
function liveFail(r,what){$('hsStatus').textContent='FAILED';
  hsLine(`<span class="err">✕ ${what} failed — ${r.status?'HTTP '+r.status:r.err}</span>`);showDoctor(r,what);}

async function liveConnect(){
  const myGen=++hsGen;window.W1_HS_ABORT=false;
  readLiveCfg();
  const via=LIVE.linkVia||'modbus';
  const ip=$('ip').value.trim(),port=$('port').value.trim(),unit=$('unitId').value.trim()||'1',fwv=$('fw').value;
  SIM.cfg.ip=ip;SIM.cfg.port=+port||502;SIM.cfg.unit=+unit||1;SIM.cfg.fw=fwv;
  $('devIP').textContent=`${ip}:${port}`;$('devFW').textContent='FW '+fwv+' · LIVE';
  $('boot').classList.add('hidden');$('handshake').classList.remove('hidden');
  $('hsLines').innerHTML='';$('hsBar').style.width='0%';$('hsStatus').textContent='LIVE LINK';
  const bar=p=>$('hsBar').style.width=p+'%';

  if(via==='modbus'){
    /* ---- DIRECT MODBUS: PRE-FLIGHT (ping + first SPL register), then full link ---- */
    LIVE.configOk=false;
    hsLine(`<span class="dim">witnessone</span> link --live --direct-modbus ${ip}:${port} --unit ${unit} --template ${W1_ACTIVE_TEMPLATE.id}`);
    bar(8);
    if(!W1AGENT.present)await REGISTRY.detectAgent().catch(()=>{});
    if(myGen!==hsGen)return; // cancelled while waiting on agent detection
    if(!W1AGENT.present){
      hsLine(`<span class="err">WitnessONE Agent not running on this laptop — direct Modbus unavailable; continuing in SIMULATION</span>`);
      hsLine(`<span class="dim">  fix → double-click WitnessONE.exe (or run_agent.bat) and reconnect</span>`);
    }else{
      hsLine(`Agent OK — <span class="acc">${(W1AGENT.info||{}).version||''} @ 127.0.0.1:5710</span>`);
      /* ① reachability — a real system ping + TCP :port check */
      hsLine(`Pre-flight ① · reachability — ping ${ip} …`);
      const pg=await W1AGENT.ping({host:ip,port:+port||502});bar(24);
      if(myGen!==hsGen)return; // cancelled — e.g. the ping stalled on an unreachable subnet
      if(pg.ok)hsLine(`  <span class="ok">✔ host answers</span> — ${pg.icmp?'ICMP ping OK':'ICMP blocked'}${pg.tcp?` · TCP :${port} open`:''} (${pg.ms??'—'} ms)`);
      else hsLine(`  <span class="err">✕ no answer — ping failed and TCP :${port} refused</span> <span class="dim">(power? cable? IP? VM network bridged?)</span>`);
      /* ② first register of the SELECTED SPL revision */
      const fp=window.SPL_DB.points.find(p=>p.addrs&&p.addrs.length);
      const fAddr=fp?fp.addrs[0]:30001;
      let mOK=false, pbRaw=null;   // pbRaw hoisted so the preflight read value survives into the session mint below
      if(pg.ok){
        hsLine(`Pre-flight ② · first SPL point — ${fp?fp.id+' '+fp.name.slice(0,26):''} @ <span class="acc">${fAddr}</span> …`);
        const pb=await W1AGENT.probe({ip,port:+port||502,unit:+unit||1,addr:fAddr});bar(40);
        if(myGen!==hsGen)return; // cancelled while the register probe was in flight
        if(pb.ok){mOK=true;pbRaw=pb.value;
          hsLine(`  <span class="ok">✔ ${fAddr} = ${pb.value}</span> (${pb.ms} ms) — REAL MODBUS CONFIRMED`);}
        else hsLine(`  <span class="err">✕ register read failed — ${String(pb.error||'no response').slice(0,60)}</span> <span class="dim">(unit ID right? Modbus enabled on the unit?)</span>`);
      }else bar(40);
      /* gate: both green → full live link; otherwise run SIMULATED so the visit isn't wasted */
      if(mOK){
        const pr=await LIVE.agentProbe();bar(80);
        if(myGen!==hsGen)return; // cancelled while the block-read confirmation was in flight
        if(pr.ok){LIVE.valuesLive=true;LIVE.source='agent';
          /* v0.8.3 P1: mint a provenance session bound to the preflight evidence
             that just passed (① ping + ② real register read). This session id and
             preflight record are stamped on the certificate. */
          LIVE.mintSession({pingMs:pg.ms,probeAddr:fAddr,probeRaw:pbRaw,at:new Date().toISOString()});
          const n=Object.keys((pr.raw.data||{}).values||{}).length;
          hsLine(`Direct Modbus → <span class="ok">${n} registers per block-read cycle (FC04 · FC03 · FC02)</span> — FULL LIVE telemetry`);
          hsLine(`Session <span class="acc">${LIVE.sessionId}</span> — provenance seal active`,'dim');
          hsLine(`Writes <span style="color:var(--warn)">DISARMED</span> — polling is read-only until armed on the bench`,'dim');}
        else hsLine(`Block read failed after a good probe (${pr.raw&&(pr.raw.status||pr.raw.err)}) — <span style="color:var(--warn)">values stay SIMULATED</span>`);
      }else{
        LIVE.enabled=false;LIVE.valuesLive=false;
        hsLine(`<span style="color:var(--warn)">■ PRE-FLIGHT NOT PASSED — opening in SIMULATION.</span> Fix the link, then ☰ MENU → ⏏ Change asset to retry.`);
      }
    }
  }else{
    /* ---- TOP SERVER: Config API provisioning + optional IoT Gateway values ---- */
    hsLine(`<span class="dim">witnessone</span> link --live --topserver ${LIVE.cfg.base} --device ${ip}.${unit} --template ${W1_ACTIVE_TEMPLATE.id}`);
    const ab=await LIVE.about();bar(12);
    if(myGen!==hsGen)return; // cancelled while waiting on Configuration API
    if(!ab.ok)return liveFail(ab,'GET /config/v1/about');
    LIVE.configOk=true;
    hsLine(`Configuration API OK — <span class="acc">${(ab.data||{}).product_name||'TOP Server'} ${(ab.data||{}).product_version||''}</span>  (${ab.ms} ms · Basic auth)`);
    const chs=await LIVE.channels();bar(24);
    if(myGen!==hsGen)return; // cancelled while browsing channels
    if(!chs.ok)return liveFail(chs,'GET /config/v1/project/channels');
    hsLine(`Project browse → <span class="ok">${(chs.data||[]).length} channel(s)</span> ${(chs.data||[]).slice(0,4).map(c=>c['common.ALLTYPES_NAME']).join(' · ')||''}`);
    hsLine(`Target ${LIVE.target.mode==='provision'?'(provision)':'(existing)'} → <span class="acc">${LIVE.target.ch}.${LIVE.target.dev}</span>`);
    try{await LIVE.provision(ip,unit,m=>hsLine('  '+m,'dim'));}
    catch(r){if(myGen!==hsGen)return;return liveFail(r,'Provisioning (POST channels/devices/tags)');}
    if(myGen!==hsGen)return; // cancelled during provisioning
    bar(56);
    const tg=await LIVE.tags(LIVE.target.ch,LIVE.target.dev);bar(66);
    if(myGen!==hsGen)return; // cancelled while verifying tags
    if(tg.ok)hsLine(`Verify → GET …/${LIVE.target.dev}/tags: <span class="ok">${(tg.data||[]).length} tags on device</span>`);
    LIVE.buildTagMap();
    if(LIVE.cfg.iot){
      const pr=await LIVE.iotProbe();bar(88);
      if(myGen!==hsGen)return; // cancelled while probing the IoT Gateway
      if(pr.ok){LIVE.valuesLive=true;LIVE.source='iot';
        LIVE.mintSession({pingMs:null,probeAddr:'iotgateway/read',probeRaw:null,at:new Date().toISOString()});
        hsLine(`Live values → <span class="ok">/iotgateway/read OK</span> — FULL LIVE telemetry (${LIVE.st.tagTotal} registers)`);
        hsLine(`Session <span class="acc">${LIVE.sessionId}</span> — provenance seal active`,'dim');}
      else hsLine(`IoT Gateway not responding (${pr.raw&&(pr.raw.status||pr.raw.err)}) — <span style="color:var(--warn)">values stay SIMULATED</span>`);
    }else{bar(88);
      hsLine(`No IoT Gateway URL — config is LIVE, values SIMULATED (add the gateway URL for live values)`,'dim');}
  }
  if(myGen!==hsGen)return; // cancelled just before hand-off
  bar(100);
  hsLine(`<span class="ok">■ LIVE LINK ESTABLISHED — ${[LIVE.configOk?'TOP Server config':null,LIVE.valuesLive?(LIVE.source==='agent'?'direct Modbus values':'gateway values'):null].filter(Boolean).join(' + ')||'session open'}</span>`);
  $('hsStatus').textContent='LINKED · LIVE';
  setTimeout(()=>{if(myGen===hsGen)startApp();},900);
}

/* ---------- wire up ---------- */
addEventListener('DOMContentLoaded',async()=>{
  const saveSel=()=>{try{sessionStorage.setItem('w1conn',JSON.stringify({
    ip:$('ip').value,port:$('port').value,unit:$('unitId').value,
    make:$('make').value,model:$('model').value,fw:$('fw').value,mode}));}catch(e){}};
  $('btnConnect').onclick=()=>{saveSel();mode==='live'?liveConnect():simConnect();};
  $('btnHsCancel').onclick=hsCancel;
  $('btnBack').onclick=()=>{
    if(window.FWT&&FWT.running&&!confirm('A test sequence is running — abort it and return to the connect screen?'))return;
    try{sessionStorage.setItem('w1back','1');}catch(e){}
    location.reload();};
  $('btnDiscover').onclick=runDiscovery;
  $('btnDiscClose').onclick=()=>$('discModal').classList.add('hidden');
  $('btnDiscCancel').onclick=()=>$('discModal').classList.add('hidden');
  $('btnDiscAdopt').onclick=()=>{$('discModal').classList.add('hidden');
    $('make').value='VERTIV';$('make').onchange();$('fw').value='1.0b19';
    toast('Discovery result adopted — VERTIV XDU1350B · fw 1.0b19','good');};
  $('segSim').onclick=()=>setMode('sim');
  $('segLive').onclick=()=>setMode('live');
  // --- keyboard layer: Enter connects from the boot form, Escape closes the top modal ---
  document.querySelectorAll('.xbtn').forEach(b=>{if(!b.getAttribute('aria-label')){b.setAttribute('aria-label','Close');b.title='Close';}});
  const MODALS=['helpModal','flowModal','aboutModal','reportModal','explModal','libModal','regModal','discModal','doctorModal'];
  addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(window.W1_MENUCLOSE&&W1_MENUCLOSE()){e.preventDefault();return;}
      const bench=$('bench');
      if(bench&&bench.classList.contains('open')){bench.classList.remove('open');e.preventDefault();return;}
      for(const id of MODALS){const m=$(id);
        if(m&&!m.classList.contains('hidden')){m.classList.add('hidden');e.preventDefault();return;}}
      const hs=$('handshake');
      if(hs&&!hs.classList.contains('hidden')){hsCancel();e.preventDefault();return;}
    }
    if(e.key==='Enter'&&!$('boot').classList.contains('hidden')){
      const t=e.target;
      if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT')){e.preventDefault();$('btnConnect').click();}
    }
  });
  const menuP=$('menuPanel'),menuB=$('btnMenu');
  const menuClose=()=>{if(menuP&&!menuP.classList.contains('hidden')){menuP.classList.add('hidden');menuB.setAttribute('aria-expanded','false');return true;}return false;};
  if(menuB){menuB.onclick=e=>{e.stopPropagation();
    const open=menuP.classList.contains('hidden');
    menuP.classList.toggle('hidden',!open);menuB.setAttribute('aria-expanded',String(open));};
    document.addEventListener('click',e=>{if(!menuP.classList.contains('hidden')&&!e.target.closest('#menuWrap'))menuClose();});
    menuP.querySelectorAll('.mitem').forEach(m=>m.addEventListener('click',()=>setTimeout(menuClose,60)));}
  window.W1_MENUCLOSE=menuClose;
  $('btnMbTest').onclick=async()=>{
    const el=$('mbStatus');
    if(!W1AGENT.present)await REGISTRY.detectAgent().catch(()=>{});
    if(!W1AGENT.present){el.textContent='✕ Agent not running — start WitnessONE.exe / run_agent.bat first';el.style.color='var(--crit)';return;}
    const ip=$('ip').value.trim(),port=+($('port').value.trim())||502,unit=+($('unitId').value.trim())||1;
    const addr=parseInt($('mbAddr').value.trim(),10)||30001;
    el.textContent='reading '+addr+' @ '+ip+':'+port+' …';el.style.color='var(--txt3)';
    const r=await W1AGENT.probe({ip,port,unit,addr});
    if(r.ok){el.textContent=`✔ ${r.addr} = ${r.value} · ${r.ms} ms · REAL MODBUS TCP`;el.style.color='var(--good)';
      toast(`⚡ Live register read: ${r.addr} = ${r.value} (${r.ms} ms) — the link is real`,'good',4200);}
    else{el.textContent='✕ '+(r.error||'no response').slice(0,60);el.style.color='var(--crit)';
      toast('Probe failed — check power, IP (ping it), port 502, unit ID, firewall','warn',5200);}
  };
  $('lvModbus').onclick=()=>setLinkVia('modbus');
  $('lvTops').onclick=()=>setLinkVia('topserver');
  setLinkVia('modbus');
  $('btnApiTest').onclick=testApi;
  $('btnExplore').onclick=()=>openExplorer(false);
  $('btnExplClose').onclick=()=>$('explModal').classList.add('hidden');
  $('btnExplRefresh').onclick=refreshExplorer;
  $('btnExplOk').onclick=applyExplorer;
  $('btnDocClose').onclick=()=>$('doctorModal').classList.add('hidden');
  $('btnDocRetry').onclick=()=>{$('doctorModal').classList.add('hidden');
    if(!$('handshake').classList.contains('hidden'))liveConnect();else testApi();};
  $('btnDocSim').onclick=()=>{$('doctorModal').classList.add('hidden');
    LIVE.enabled=false;LIVE.valuesLive=false;setMode('sim');
    if(!$('handshake').classList.contains('hidden'))simConnect();};
  $('btnBridgeDl').onclick=dlBridge;
  $('btnLibrary').onclick=()=>{$('libModal').classList.remove('hidden');renderLibrary();};
  $('btnLibClose').onclick=()=>$('libModal').classList.add('hidden');
  $('btnLibSync').onclick=libSync;
  wireAddReg();
  try{SCENE.init();}catch(e){console.error('3D init failed:',e);}
  await REGISTRY.detectAgent();
  await REGISTRY.load();
  fillCatalog();updAgentChip();
  try{const sv=JSON.parse(sessionStorage.getItem('w1conn')||'null');
    if(sv&&sessionStorage.getItem('w1back')){
      sessionStorage.removeItem('w1back');
      $('ip').value=sv.ip;$('port').value=sv.port;$('unitId').value=sv.unit;
      if([...$('make').options].some(o=>o.value===sv.make)){$('make').value=sv.make;$('make').onchange();}
      if([...$('model').options].some(o=>o.value===sv.model)){$('model').value=sv.model;$('model').onchange();}
      if([...$('fw').options].some(o=>o.value===sv.fw)){$('fw').value=sv.fw;$('fw').onchange();}
      if(sv.mode==='live')setMode('live');
      toast('⏏ Back at the connect screen — selections restored. Adjust and reconnect.','',3600);}}catch(e){}
});
})();
</script>
