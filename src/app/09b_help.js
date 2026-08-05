<script>
/* ============ WitnessONE in-app Help + Architecture flowchart ============ MG */
(function(){
const $=id=>document.getElementById(id);
const HELP=window.HELP={};

const TABS=[
 {id:'what',label:'What is this?',html:`
  <h3>WitnessONE in one minute</h3>
  <p>WitnessONE is a <b>commissioning toolbox</b>. You plug a laptop into a factory-witness-test asset (right now a Vertiv XDU1350B CDU), the tool reads its Modbus registers live, shows the machine as a 3D twin, and walks a commissioning agent through a scripted witness test that ends in a <b>signed certificate</b>.</p>
  <p>Everything runs from one file. There is nothing to install for the person using it — double-click, a window opens, you work.</p>
  <div class="hcards">
   <div class="hcard"><b>1 · Connect</b><span>Enter the equipment IP / port, pick make·model·firmware, choose how you want data.</span></div>
   <div class="hcard"><b>2 · Watch</b><span>Live points table + 3D twin. Silent points are flagged; the RX counter shows how many registers are answering.</span></div>
   <div class="hcard"><b>3 · Test</b><span>Run the witnessed field script — the failure comes from the unit, the tool times and records it.</span></div>
   <div class="hcard"><b>4 · Certify</b><span>Generate the Level-1 certificate; the run is archived on the laptop.</span></div>
  </div>`},
 {id:'modes',label:'Data modes',html:`
  <h3>Two modes on the connect screen — LIVE then expands into a link choice</h3>
  <table class="htab">
   <tr><th>Mode</th><th>What it does</th><th>When to use</th></tr>
   <tr><td><span class="pill sim">SIMULATION</span></td><td>A built-in physics model of the asset. No device needed.</td><td>Demos, training, checking the tool itself.</td></tr>
   <tr><td><span class="pill live">LIVE</span></td><td>Real connection to the asset. Expanding it asks <b>how to link</b>:</td><td>On site, plugged into the unit.</td></tr>
   <tr><td style="padding-left:22px"><span class="pill live">🔌 Direct Modbus</span></td><td>The Agent reads the asset's registers straight over Modbus TCP. <b>No middleware, no license.</b></td><td><b>The field MVP</b> — default. Straight to the machine.</td></tr>
   <tr><td style="padding-left:22px"><span class="pill live">🗄 TOP Server</span></td><td>Provisions the device in TOP Server (Config API) and reads values via its IoT Gateway if licensed.</td><td>Sites standardized on TOP Server.</td></tr>
  </table>
  <p class="note">The chip at the bottom of the screen always tells you the truth about where the numbers come from: <span class="pill sim">SIMULATED</span>, <span class="pill hy">LIVE CONFIG · VALUES SIMULATED</span>, or <span class="pill live">FULL LIVE</span>.</p>`},
 {id:'safe',label:'Is it safe?',html:`
  <h3>Reading a live machine is safe. Writing is gated.</h3>
  <p><b>Reads</b> use one persistent Modbus connection with small, bounded requests — the same request/response protocol BMS/SCADA systems use to poll these units around the clock. Reading does not disturb the equipment.</p>
  <p><b>Writes</b> (changing a setpoint) are the only thing that can affect the machine, so they are <b>disabled by default</b>. The topbar shows <span class="pill ok2">READ-ONLY</span>. To write you must open the Test Bench and click <b>ARM</b> — the chip turns <span class="pill bad2">WRITES ARMED</span> red. Disarm restores read-only.</p>
  <p class="note">The <b>Fault injection</b> buttons in the Test Bench are <b>SIMULATION ONLY</b> — a feedback toy. They never touch a real device.</p>`},
 {id:'discover',label:'Register sweep',html:`
  <h3>“Something isn't coming through” → sweep the registers</h3>
  <p>You already know the device IP. The sweep walks its Modbus address space <b>read-only</b> and overlays the result on the SPL template:</p>
  <ul>
   <li><b>Responding</b> — SPL registers answering normally.</li>
   <li><b>Silent</b> — SPL registers that don't answer. They stay flagged in the points table (grey “—”) and the <b>RX counter drops</b> (e.g. RX 21/22).</li>
   <li><b>NEW ◆</b> — a register that answers but isn't in your template (often a new firmware). One click opens <b>＋ REG</b> to add it.</li>
  </ul>`},
 {id:'update',label:'New register → commit',html:`
  <h3>Found a register the list doesn't have — or testing an older SPL</h3>
  <p><b>The points list is its own versioned artifact.</b> On the connect screen you pick the
  <b>SPL revision</b> to witness against — v4.17, v4.18 … or SPL 1.0, whichever this project uses.
  Approved revisions are <b>never modified</b> on the laptop.</p>
  <p>Datasheet shows a register the list doesn't have? <b>＋ REG</b>: name, address, type, gain,
  units — it goes live in the points table immediately. What happens underneath:</p>
  <div class="hflow">
   <span>Add register</span><i>→</i><span>Approved list <b>kept intact</b> — a <b>FIELD DRAFT</b> revision is forked</span><i>→</i><span>Draft saved on <b>this laptop</b> + commit <b>queued</b></span><i>→</i><span>Central DB approves → published as the <b>next revision</b></span>
  </div>
  <p class="note">Drafts are clearly labeled in the selector and stamped on the certificate as
  <b>pending registry approval</b>. Switch back to the approved revision at any time — nothing was touched.</p>`},
 {id:'test',label:'Witnessed test',html:`
  <h3>Witnessed field test — proof it works both ways</h3>
  <p>Open <b>Run Witness Test → WITNESSED · FIELD EVENTS</b>. Each card is a real commissioning check. The event comes from the <b>unit</b>, not the tool:</p>
  <div class="hflow vert">
   <span>① <b>ARM</b> the step — tool starts trending the watch-points</span>
   <span>② Vendor performs the action on the machine (trip a pump, actuate leak…)</span>
   <span>③ Tool <b>auto-detects & timestamps</b> the real alarm (or mark it manually)</span>
   <span>④ You confirm — tool watches the <b>return to normal</b></span>
   <span>⑤ Recovered & timestamped → <b>PASS</b>. Times + notes go on the certificate.</span>
  </div>`},
 {id:'gloss',label:'Glossary',html:`
  <h3>Terms on screen</h3>
  <table class="htab">
   <tr><td><b>SPL</b></td><td>Standard Point List — the approved Equinix register map for this asset (26 points here).</td></tr>
   <tr><td><b>Modbus / FC02·03·04·06</b></td><td>The industrial protocol. FC04/03 read registers, FC02 reads alarms, FC06 writes a setpoint.</td></tr>
   <tr><td><b>GOOD (192) / BAD (24)</b></td><td>OPC quality codes: 192 = healthy live read, 24 = comms failure. Proof each read was live.</td></tr>
   <tr><td><b>RX n/n</b></td><td>How many mapped registers are answering right now.</td></tr>
   <tr><td><b>TOP Server</b></td><td>Equinix's standard OPC/Modbus server. Optional here — the MVP talks Modbus directly.</td></tr>
   <tr><td><b>Agent</b></td><td>The local service inside the app that does real Modbus, registry sync and record-keeping.</td></tr>
   <tr><td><b>Template / registry</b></td><td>Each make·model is one JSON template (identity + SPL + 3D + test script). The registry is the library; it syncs to a central DB.</td></tr>
   <tr><td><b>Deviation / NEW</b></td><td>DEV = approved SPL exception. NEW = a register added in the field, pending central approval.</td></tr>
  </table>`},
];

function render(tab){
  $('helpTabs').innerHTML=TABS.map(t=>`<button class="htab-btn${t.id===tab?' on':''}" data-t="${t.id}">${t.label}</button>`).join('');
  $('helpBody').innerHTML=(TABS.find(t=>t.id===tab)||TABS[0]).html;
  $('helpTabs').querySelectorAll('.htab-btn').forEach(b=>b.onclick=()=>render(b.dataset.t));
}
HELP.open=function(tab){$('helpModal').classList.remove('hidden');render(tab||'what');};
HELP.init=function(){
  const b=$('btnHelp');if(b)b.onclick=()=>HELP.open('what');
  const c=$('btnHelpClose');if(c)c.onclick=()=>$('helpModal').classList.add('hidden');
  const f=$('btnHelpFlow');if(f)f.onclick=()=>{window.FLOW&&FLOW.open();};
};
addEventListener('DOMContentLoaded',()=>HELP.init());
})();
</script>
