<script>
/* ============ WitnessONE certificate generator — Level 1 FWT ============ MG */
(function(){
const REPORT=window.REPORT={};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
/* CERT-4: derive the effective run start from the witnessed timeline when available
   (baseResults currently stamps startedAt/finishedAt at synthesis time — see followups). */
function runStart(R){
  let t=R&&R.startedAt?+new Date(R.startedAt):NaN;
  if(R&&R.witnessed&&R.witnessed.length){
    R.witnessed.forEach(w=>[w.armedAt,w.trigAt,w.recAt].forEach(x=>{
      if(x){const n=+new Date(x);if(!isNaN(n)&&(isNaN(t)||n<t))t=n;}}));}
  return isNaN(t)?Date.now():t;}
function runEnd(R){
  let t=R&&R.finishedAt?+new Date(R.finishedAt):NaN;
  if(R&&R.witnessed&&R.witnessed.length){
    R.witnessed.forEach(w=>[w.armedAt,w.trigAt,w.recAt].forEach(x=>{
      if(x){const n=+new Date(x);if(!isNaN(n)&&(isNaN(t)||n>t))t=n;}}));}
  return isNaN(t)?Date.now():t;}
/* CERT-4: build the certificate number once, from the run start (not render time). */
function certNo(R){const d=new Date(runStart(R));const p=n=>String(n).padStart(2,'0');
  const tag=(R&&R.assetTag)||'CDU-01';
  return `FWT-${tag}-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}·R0`;}
/* CERT-3: this is the 05_sim.js demo cfg.serial constant, not a captured serial —
   never print it as a real serial. Proper fix: capture serial on the connect form
   into SIM.cfg.serial (05_sim.js/08_test.js — see followups). */
const SERIAL_PLACEHOLDER='VXDU1350B-2647-0114';
const RES_CLS={PASS:'P',DEV:'D',FAIL:'F',NA:'N',DEFER:'N',pass:'P',dev:'D',fail:'F',na:'N'};
const RES_TXT={pass:'PASS',dev:'PASS ▲DEV',fail:'FAIL',na:'N/A'};

/* v0.8.3 P1: per-value read time HH:MM:SS.mmm (LIVE only). */
function readAt(ts){if(ts==null)return '—';const d=new Date(ts);const p=(n,w=2)=>String(n).padStart(w,'0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;}

function paperHTML(R){
  const no=R.certNo||(R.certNo=certNo(R));
  const dt=new Date(runStart(R));
  const fin=new Date(runEnd(R));
  const dur=Math.max(0,Math.round((fin-dt)/1000));
  const simDeck=!!(R.steps&&R.steps.length);
  const vb=R.overall.startsWith('PASS WITH')?'warn':(R.overall.startsWith('FAIL')?'fail':'');
  /* v0.8.3 P0 — ISSUANCE GATE. A certificate is only a certificate when its
     point-to-point values were read LIVE. A simulated/hybrid session renders as a
     clearly-marked DEMONSTRATION: watermarked, no RED TAG, verdict prefixed DEMO —
     so the tool is structurally incapable of issuing a passing certificate from
     unverified data. */
  const isLive=(R.dataSource||'').startsWith('LIVE');
  const showReadAt=isLive;
  const p2pRows=R.p2p.map(r=>`<tr><td class="num">${r.id}</td><td>${esc(r.name)}</td><td class="num">${esc(r.addr)}</td>
    <td class="num">${esc(r.raw)}</td><td class="num">${esc(r.val)} ${esc(r.units)}</td><td class="num">${esc(r.q)}</td>
    ${showReadAt?`<td class="num" style="font-size:9px">${esc(readAt(r.ts))}${r.fc?'<br>FC'+r.fc:''}</td>`:''}
    <td class="${RES_CLS[r.res]||''}">${r.res}</td><td>${esc(r.note||'')}</td></tr>`).join('');
  const fnRows=R.steps.map(s=>`<tr><td class="num">${s.id.slice(0,3)}-${s.id.slice(3)}</td><td><b>${esc(s.name)}</b><br>
    <span style="color:#6b7280">${esc(s.desc)}</span></td><td>${esc(s.expected)}</td><td>${esc(s.actual)}</td>
    <td class="${RES_CLS[s.status]}">${RES_TXT[s.status]}</td></tr>`).join('');
  const punchRows=R.punch.map(p=>`<tr><td class="num">${p.no}</td><td class="${p.sev==='Critical'?'F':p.sev==='Major'?'D':''}">${p.sev}</td>
    <td>${esc(p.item)}</td><td>${esc(p.action)}</td><td>${esc(p.owner)}</td>
    <td class="${p.status==='OPEN'?'D':'P'}">${p.status}</td></tr>`).join('');
  const passN=R.p2p.filter(r=>r.res==='PASS').length, devN=R.p2p.filter(r=>r.res==='DEV').length,
        naN=R.p2p.filter(r=>r.res==='NA'||r.res==='DEFER').length, failN=R.p2p.filter(r=>r.res==='FAIL').length;
  /* CERT-3: derive the comms/quality check from the actual reads — never emit a fixed PASS. */
  const readable=R.p2p.filter(r=>r.res!=='NA'&&r.res!=='DEFER');
  const goodQN=readable.filter(r=>/192/.test(String(r.q))).length;
  const commsOK=readable.length>0&&goodQN===readable.length;
  return `<div class="paper">
    <style>
    /* UX-7: give the contenteditable signature/engineer fields a real affordance + focus ring */
    .paper [contenteditable]{border-bottom:1px dashed #9ca3af;border-radius:2px;padding:0 3px;cursor:text;background:#fffbf5;transition:background .12s}
    .paper [contenteditable]:hover{background:#fff7ed}
    .paper [contenteditable]:focus{outline:2px solid #c2410c;outline-offset:1px;background:#fff}
    @media print{.paper [contenteditable]{border-bottom-color:transparent;background:none;outline:none;padding:0}}
    /* v0.8.3 P0: DEMONSTRATION watermark on any non-LIVE certificate */
    .paper{position:relative}
    .paper .wmk{position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;z-index:5;overflow:hidden}
    .paper .wmk span{transform:rotate(-30deg);font-size:40px;font-weight:800;letter-spacing:3px;color:rgba(194,65,12,.14);border:3px solid rgba(194,65,12,.16);padding:12px 30px;border-radius:8px;white-space:nowrap;text-align:center;line-height:1.3}
    @media print{.paper .wmk span{color:rgba(194,65,12,.2)}}
    </style>
    ${isLive?'':'<div class="wmk"><span>SIMULATION DEMO<br>NOT A CERTIFICATE</span></div>'}
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <span class="eqxr">EQUINIX</span> <span style="color:#6b7280;font-size:10px;letter-spacing:2px">COMMISSIONING</span>
        <h1>FACTORY WITNESS TEST CERTIFICATE${isLive?'':' <span style="color:#c2410c">(DEMONSTRATION)</span>'}</h1>
        <div style="color:#374151;font-weight:600">Level 1 Commissioning · ${esc(R.assetClass||R.meta.Equipment||'Asset')}</div>
      </div>
      <div style="text-align:right;flex:0 0 auto">
        ${(!isLive||R.overall.startsWith('FAIL'))?'':'<span class="stamp">RED TAG ✔</span>'}
        <div style="font-family:monospace;font-size:10px;margin-top:8px;white-space:nowrap"><b>Cert No.</b> ${no}</div>
        <div style="font-family:monospace;font-size:9.5px;color:#6b7280;white-space:nowrap">${esc(R.scriptId||'FWT-01-R1')} · ${esc(R.meta['Equinix Point List Version:']||'SPL')}</div>
      </div>
    </div>

    <h2>1 · Equipment under test</h2>
    <div class="kv">
      <div><span>Equipment / tag</span><b>${esc(R.assetClass||'Asset')} · ${esc(R.assetTag||'AST-01')}</b></div>
      <div><span>Make</span><b>${esc(R.meta.Make)}</b></div>
      <div><span>Model</span><b>${esc(R.meta.Model)}</b></div>
      <div><span>Serial No.</span><b>${esc((()=>{const s=R.assetClass==='CDU'?R.cfg.serial:null;return s&&s!==SERIAL_PLACEHOLDER?s:'(record on unit)';})())}</b></div>
      <div><span>Firmware</span><b>${esc(R.cfg.fw)} (SPL-approved: ${esc(R.meta['Firmware Version'])})</b></div>
      <div><span>Points list</span><b>${esc(window.W1_SPLFMT?W1_SPLFMT(R.splVersion||R.meta['Equinix Point List Version:']):(R.splVersion||''))}${R.revStatus&&R.revStatus!=='approved'?' <span style="color:#b45309">[FIELD DRAFT — pending registry approval]</span>':''} — ${esc(R.meta['Asset Compliance Status'])}</b></div>
      <div><span>Test date</span><b>${dt.toLocaleString()}</b></div>
      <div><span>Duration</span><b>${dur}s${simDeck?' (accelerated demo)':''}</b></div>
      <div><span>Location</span><b>Vendor factory — witness bay</b></div>
      <div><span>Data path</span><b>${esc((R.dataSource||'').startsWith('LIVE — Direct')?'Direct Modbus TCP/IP':'TOP Server v7.1 · Modbus TCP/IP')} · ${esc(R.cfg.ip)}:${R.cfg.port}.${R.cfg.unit}</b></div>
      <div><span>Test platform</span><b>WitnessONE v0.8.3</b></div>
      <div><span>Data source</span><b>${esc(R.dataSource||'SIMULATED')}</b></div>
      <div><span>Session ID</span><b>${esc(R.sessionId||'— (no live session)')}</b></div>
      <div><span>Agent record</span><b>${R.agentRecordId?('#'+esc(R.agentRecordId)):'not archived (agent offline)'}</b></div>
      <div><span>Test engineer</span><b contenteditable="true">MG</b></div>
    </div>

    <h2>2 · Pre-test verification</h2>
    <div style="font-size:9.5px;color:#6b7280;margin-bottom:3px">The tool does not evaluate the checks below — the witness records the result of each against the asset's acceptance pack before signing (click a cell to mark).</div>
    <table><tr><th>Check</th><th style="width:64px">Result</th></tr>
      <tr><td>Unit assembled per approved drawings; QA documentation pack complete</td><td contenteditable="true">—</td></tr>
      <tr><td>Instrument / sensor calibration certificates current for metered points</td><td contenteditable="true">—</td></tr>
      <tr><td>Mechanical / electrical integrity witnessed per the asset's acceptance checklist</td><td contenteditable="true">—</td></tr>
      <tr><td>Electrical safety: supply, earthing, protective devices verified</td><td contenteditable="true">—</td></tr>
      ${isLive
        ?`<tr><td>Comms established: live Modbus TCP session · ${readable.length} tags read · ${goodQN}/${readable.length} OPC quality GOOD (192)</td><td class="${commsOK?'P':(readable.length?'D':'')}">${commsOK?'PASS':(readable.length?goodQN+'/'+readable.length+' GOOD':'—')}</td></tr>`
        :`<tr><td>Comms established: live Modbus TCP session with per-value provenance</td><td class="N">N/A — no live session (simulated demonstration)</td></tr>`}</table>

    <h2>3 · Point-to-point verification — ${esc(R.meta['Equinix Point List Version:'])} (${R.p2p.length} points)</h2>
    <div style="font-size:10.5px;color:#374151;margin-bottom:4px">Summary: <b class="P">${passN} PASS</b> · <b class="D">${devN} approved deviations</b> · <b class="N">${naN} N/A / deferred</b> · <b class="F">${failN} FAIL</b></div>
    <table><tr><th>ID</th><th>Point</th><th>Register(s)</th><th>Raw</th><th>Scaled</th><th>Quality</th>${showReadAt?'<th>Read at</th>':''}<th>Result</th><th>Note</th></tr>${p2pRows}</table>

    ${R.steps&&R.steps.length?`<h2>4 · Functional &amp; performance tests (scripted demo)</h2>
    <table><tr><th>Test ID</th><th style="width:26%">Test</th><th>Acceptance criteria</th><th>Measured</th><th style="width:70px">Result</th></tr>${fnRows}</table>`:''}
    ${(R.witnessed&&R.witnessed.length)?`<h2>4b · Witnessed field tests — event from the unit, tool observed &amp; timestamped</h2>
    <table><tr><th>ID</th><th style="width:24%">Test / vendor instruction</th><th>Armed</th><th>Triggered</th><th>Recovered</th><th style="width:56px">Result</th><th>Notes</th></tr>
    ${R.witnessed.map(w=>`<tr><td class="num">${w.id}</td><td><b>${esc(w.title)}</b><br><span style="color:#6b7280">${esc(w.instr)}</span></td>
      <td class="num">${w.armedAt?new Date(w.armedAt).toLocaleTimeString():'—'}</td>
      <td class="num">${w.trigAt?new Date(w.trigAt).toLocaleTimeString()+'<br>(+'+((w.trigAt-w.armedAt)/1000).toFixed(1)+' s)'+(w.manualTrig?' · manual mark':' · auto-detect'):'—'}${w.trigSnap?`<br><span style="color:#6b7280;font-size:9px">${esc(w.trigSnap)}</span>`:''}</td>
      <td class="num">${w.recAt?new Date(w.recAt).toLocaleTimeString()+'<br>(+'+((w.recAt-w.trigAt)/1000).toFixed(1)+' s after event)'+(w.manualRec?' · manual':' · auto'):'—'}${w.recSnap?`<br><span style="color:#6b7280;font-size:9px">${esc(w.recSnap)}</span>`:''}</td>
      <td class="${w.pass?'P':'F'}">${w.pass?'PASS':'FAIL'}</td><td>${esc(w.note||'')}</td></tr>`).join('')}</table>`:''}

    <h2>5 · Deviations &amp; punch list</h2>
    <table><tr><th>#</th><th>Severity</th><th>Item</th><th>Action</th><th>Owner</th><th>Status</th></tr>${punchRows}</table>

    <div class="verdict ${vb}">${esc((isLive?'':'DEMO — ')+R.overall)}</div>
    <div style="text-align:center;font-weight:700;color:#374151">${esc(isLive?R.shipRec:'DEMONSTRATION ONLY — not a witnessed result; connect a live device to issue a certificate')}</div>

    <h2>6 · Attendance &amp; approval</h2>
    <div style="font-size:10.5px;color:#374151;margin-bottom:6px">Minimum attendance per Level 1 practice: vendor representative, owner's commissioning provider (CxA), owner/GC representative. Results reviewed against pre-agreed script ${esc(R.scriptId||'FWT-01')}; both parties retain signed copies.</div>
    <div class="sig">
      <div class="box"><b>Vendor Representative</b><span contenteditable="true">Name · ${esc(R.meta.Make)}</span><br>Signature / date: ____________</div>
      <div class="box"><b>Commissioning Agent (CxA)</b><span contenteditable="true">Name · Equinix Cx</span><br>Signature / date: ____________</div>
      <div class="box"><b>Owner / GC Representative</b><span contenteditable="true">Name · Equinix</span><br>Signature / date: ____________</div>
    </div>
    <div style="font-size:9px;color:#9ca3af;margin-top:4px">✎ Dashed fields are editable — click a name (or the test engineer / section 2 result cells) to type it before printing or export.</div>

    <div class="foot">
      <span>References: ASHRAE Gl 0 &amp; 1.1 · ASHRAE 127-2020 (CDU rating) · OCP L2L CDU Test Methodology · Vertiv SL-71308 / SL-70619</span>
      <span>Generated by <b>WitnessONE v0.8.3</b> · Engineered by <b>MG</b> · ${fin.toLocaleString()}</span>
    </div>
    <div style="margin-top:6px;color:#9ca3af;font-size:9px">${
      (R.dataSource||'').startsWith('LIVE — Direct')?
      'Point-to-point values were read LIVE over raw Modbus TCP block reads (FC04 / FC03 / FC02) via the WitnessONE agent; each printed value carries its per-point read timestamp and function code. Functional-test dynamics are rendered by the WitnessONE model — operate the unit per the agreed script for formal FAT execution.':
      (R.dataSource||'').startsWith('LIVE')?
      'Point-to-point values were read LIVE via the TOP Server value gateway (quality codes as reported; per-point read timestamps printed). Functional-test dynamics are rendered by the WitnessONE model — operate the unit per the agreed script for formal FAT execution.':
      (R.dataSource||'').startsWith('HYBRID')?
      'Configuration was verified LIVE on TOP Server (channel/device/tags provisioned and read back via /config/v1). Telemetry values were produced by WitnessONE\'s SPL register model — connect a live value gateway for full live reads. This document is a DEMONSTRATION, not a certificate.':
      'DEMONSTRATION — telemetry produced by WitnessONE\'s simulated register model of the Equinix SPL map (addresses, function codes, gains, ranges as published). No live device was read; this document is not a certificate.'}</div>
    ${R.digest?`<div style="margin-top:4px;color:#6b7280;font-size:9px;font-family:monospace">Integrity: SHA-256 ${esc(String(R.digest).slice(0,16))}… · agent record #${esc(R.agentRecordId)} · verify: GET /records/verify/${esc(R.agentRecordId)}</div>`:''}
  </div>`;
}

function standaloneHTML(R){
  const css=document.querySelector('style').textContent;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FWT Certificate — ${esc(FWT.results.meta.Make)} ${esc(FWT.results.meta.Model)}</title>
  <style>${css}\nhtml,body{overflow:auto!important;height:auto!important;background:#e9ebef}\n.paper{margin:24px auto}</style></head>
  <body><div id="printHost" style="display:block">${paperHTML(R)}</div></body></html>`;
}
function dl(name,mime,content){const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type:mime}));a.download=name;a.click();}

REPORT.open=async function(){
  if(!FWT.results){
    if(FWT.witnessed&&FWT.witnessed.length)FWT.results=FWT.baseResults();
    else{toast('Run the witness test (or a witnessed field step) first','warn');return;}
  }
  FWT.results.witnessed=FWT.witnessed||[];
  if(FWT.results.witnessed.length&&FWT.results.witnessed.some(w=>!w.pass)){
    FWT.results.overall='FAIL — WITNESSED FIELD STEP(S) FAILED';
    FWT.results.shipRec='HOLD — resolve failed witnessed steps before shipment';
  }
  /* v0.8.3 P1: archive BEFORE rendering so the agent record id + tamper-evidence
     digest can be stamped on the certificate. Archive failure never blocks the
     render — it prints "not archived (agent offline)" instead (the read data is
     no less real, only un-filed). */
  if(window.W1AGENT&&W1AGENT.present&&!FWT.results._saved){
    FWT.results._saved=true;
    try{const r=await W1AGENT.saveRun(FWT.results);
      if(r&&r.ok){FWT.results.agentRecordId=r.id;FWT.results.digest=r.digest;
        UI.log(`Run archived — agent record #${r.id}${r.digest?' · SHA-256 '+r.digest.slice(0,16)+'…':''}`,'acc');}
    }catch(e){}
  }
  $('reportScroll').innerHTML=paperHTML(FWT.results);
  $('reportModal').classList.remove('hidden');
};
REPORT.init=function(){
  $('btnReport').onclick=()=>REPORT.open();
  $('btnRepClose').onclick=()=>$('reportModal').classList.add('hidden');
  $('btnPrint').onclick=()=>{$('printHost').innerHTML=$('reportScroll').innerHTML;window.print();};
  $('btnDlHtml').onclick=()=>dl('WitnessONE_FWT_Certificate_XDU1350B.html','text/html',standaloneHTML(FWT.results));
  $('btnDlJson').onclick=()=>dl('WitnessONE_FWT_Results.json','application/json',JSON.stringify(FWT.results,null,2));
  $('btnDlCsv').onclick=()=>{
    const R=FWT.results;
    let csv='SECTION,ID,NAME,ADDRESS,RAW,VALUE,UNITS,QUALITY,READ_AT,FC,RESULT,NOTE\n';
    R.p2p.forEach(r=>{csv+=`P2P,${r.id},"${r.name}","${r.addr}","${r.raw}","${r.val}",${r.units},"${r.q}","${r.ts?readAt(r.ts):''}","${r.fc?'FC'+r.fc:''}",${r.res},"${(r.note||'').replace(/"/g,"'")}"\n`;});
    R.steps.forEach(s=>{csv+=`FUNC,${s.id},"${s.name}",,,,,,,,"${s.status.toUpperCase()}","${s.actual.replace(/"/g,"'")}"\n`;});
    if(R.sessionId||R.digest)csv+=`\nPROVENANCE,sessionId,"${R.sessionId||''}",record,"${R.agentRecordId||''}",digest,"${R.digest||''}"\n`;
    dl('WitnessONE_FWT_Results.csv','text/csv',csv);};
};
})();
</script>
