# WitnessONE — Legal & Compliance Risk Note

Internal risk assessment. Not legal advice. This note is grounded in the code as it
stands on this branch (v0.8.3 line, commit `4f26c2d`) and in the git history of the
three review rounds. Where a statement is an assumption rather than something the code
proves, it is marked as such.

Owner: Legal. Audience: product owner (MG / Equinix Commissioning Engineering),
platform team, and whoever signs off on field use. Read alongside
`docs/OPS_POSTMORTEM.md` and `docs/RELEASE_NOTES_v0.8.3.md`.

---

## 1. Why this product carries legal exposure

WitnessONE generates a **Factory-Witness-Test (FWT) certificate** for industrial
equipment (CDUs, UPS, breakers, power meters, DX units). The certificate is a
**record of work**: it asserts that specific register values were read from a named
asset at a named time, and it renders an overall **PASS / PASS WITH APPROVED
DEVIATIONS / FAIL** verdict with a "RED TAG" stamp on a pass. Downstream parties
(the owner, the general contractor, the commissioning authority, the vendor) rely on
that document to accept equipment into service.

The core liability is therefore simple to state: **if the certificate says PASS when
the truth is FAIL, or prints a value the device never produced, WitnessONE has
manufactured a false record of a safety-relevant acceptance test.** Everything below
flows from that.

The generator lives in `src/app/09_report.js`; the verdict is computed in
`src/app/08_test.js`; live values are decoded in `src/app/05b_live.js`; the Agent that
touches real hardware and stores records is `agent/witnessone_agent.py`.

---

## 2. Evidentiary and records-integrity concerns

The first two review rounds found and fixed a set of defects that went directly to the
truthfulness of the certificate. These are the load-bearing integrity facts.

### 2.1 The verdict must reflect the results (hardcoded-PASS class of defect)

- **CERT-1 (Round 2, `ee91d2f`)** — the witnessed certificate previously could print
  PASS while FAIL rows existed in the point-to-point table. Now the report code forces
  a failing verdict when any witnessed step failed: `09_report.js` line 158–160 sets
  `overall` to `FAIL — WITNESSED FIELD STEP(S) FAILED` and the ship recommendation to
  `HOLD` before rendering. The base verdict itself is derived from the counts in
  `08_test.js` (`overall = failN>0 ? 'FAIL …' : devN>0 ? 'PASS WITH APPROVED
  DEVIATIONS' : 'PASS'`, lines 462 and 543).
- **CERT-3 (Round 3, `ef70723`)** — no fabricated PASS rows. The comms/quality line on
  the certificate is now derived from the actual reads rather than emitted as a fixed
  PASS: `09_report.js` lines 50–53 compute `goodQN` (count of points reporting OPC
  quality 192/GOOD) and only mark comms PASS when every readable point is GOOD.
- **CERT-3 serial** — the demo serial constant (`VXDU1350B-2647-0114`) is explicitly
  guarded so it is never printed as a captured serial; if no real serial was captured
  the field prints `(record on unit)` (`09_report.js` lines 25–28 and 80). **Assumption
  / open item:** serial capture on the connect form is still a TODO noted in the code,
  so today the serial is effectively never machine-captured and always falls back to
  the manual placeholder text.
- **CERT-4 (Round 2/3)** — the certificate number, date, and duration are derived from
  the witnessed run timeline, not from render (generation) time: `certNo()`,
  `runStart()`, `runEnd()` in `09_report.js` lines 7–36. This matters evidentially: the
  document's own metadata should describe when the test happened, not when someone
  reopened the report.
- **CERT-2 (Round 2)** — asset-specific punch-list items (originally CDU-only) are no
  longer injected into every asset class, so the certificate does not assert findings
  that do not apply to the equipment under test.

### 2.2 Values must be decoded correctly (wrong 32-bit / bit-mapped values)

A certificate that prints the wrong *number* is as much a false record as one that
prints the wrong verdict.

- **LIVE-1 / DATA-1 (Round 2)** — 32-bit points (float32 / int32 spans) are now
  combined from their high and low words, and bit-mapped status points apply their mask
  instead of certifying the raw 16-bit word. See `05b_live.js` lines 201–218
  (`span32` handling: `u32 = ((hi<<16)|lo)>>>0`, float32 via `DataView`, bit extraction
  via `(w>>p.bit)&1`). Before this fix, a Schneider PM8000 FLOAT32 reading or an ABB
  Emax2 bit-mapped breaker status could be printed as a meaningless bare word.
- **LIVE residual (Round 3)** — the TOP Server / IoT read path was routed through the
  *same* span32 + bitmask decode as the Agent path, so the number on the certificate
  does not depend on which data path was used.
- **DATA-6 (Round 3)** — engineering-unit range checks now use one documented semantic
  and treat inverted or full-datatype ranges as "not asserted" rather than silently
  passing or failing (`08_test.js`). This prevents a range-based PASS/FAIL from being
  fabricated out of a nonsensical min/max.

### 2.3 Provenance: live vs simulated must be honest

WitnessONE ships a fully self-contained **simulation mode**. The legal danger is a
simulated run being mistaken for a live acceptance test.

- **LIVE-2 (Round 2)** — the certificate states its data source honestly. The report
  renders `Data source` from `R.dataSource` and prints a closing statement that differs
  by mode (`09_report.js` lines 88 and 135–139): a LIVE run states values were read
  from the device data path; a SIMULATED run states plainly that telemetry was produced
  by "WitnessONE's simulated register model … MVP demonstration". The data-path line
  distinguishes Direct Modbus TCP/IP from TOP Server.
- **Link-loss honesty** — when a live link drops, the UI drops the last values so reads
  go BAD rather than being served as live GOOD (`05b_live.js` lines 177–182). Stale
  data is not passed off as fresh live data.
- **Residual risk:** the provenance statement is only as good as the operator not
  editing it out. The certificate's own body text is not tamper-evident (see §4 and
  §5), so a SIMULATED certificate can, after export, be edited by a determined user to
  read LIVE. The in-app text is honest; the exported artifact is not sealed.

---

## 3. Data retention and audit trail

### 3.1 The SQLite records store

Every witnessed run can be archived by the Agent to a local SQLite database
(`agent/witnessone_records.db`, schema in `witnessone_agent.py` lines 209–215): one
`runs` row per test, holding `ts`, `device`, `overall`, `data_source`, and the full
JSON `payload`. Records are written on report open (and on witness-test
completion) when the Agent is present (`09_report.js` lines 162–165 and
`08_test.js` lines 549–552, via `W1AGENT.saveRun` → `POST /records/runs`, defined
in `04b_registry.js` line 158).

Integrity characteristics, as coded:

- **Append-only in practice.** The only write path is `INSERT` (`witnessone_agent.py`
  line 764); there is no update or delete endpoint. Reads are `GET /records/runs`
  (latest 100, line 651) and `GET /records/runs/{id}` (full payload, line 655).
- **Local, single-file, unencrypted.** The DB sits on the field laptop next to the
  Agent (`DB_PATH = os.path.join(HERE, …)`). There is no application-level access
  control on the records endpoints beyond the origin/Host guard in §5, and the SQLite
  file is readable and writable by anyone with the laptop. A row can be altered or
  deleted directly in the file, outside the API. **This is not a tamper-evident audit
  log.** It is a local convenience archive.
- **No off-box durability by default.** Retention depends entirely on the laptop. Loss,
  theft, or reimage loses the records unless they were pushed to the central registry
  DB (roadmap Stage 3 "certificate vault", not yet built).

### 3.2 The pending_commits queue

Field changes to points-lists that cannot reach the central DB are queued locally as
JSON files under `agent/pending_commits/` (`witnessone_agent.py` lines 818–823), and
`/verify` and `/propose` report `queued: true` when the remote is offline or
unconfigured. This is a deliberate "nothing is lost in the field" design. The
compliance implication: the queue is an **unreviewed** staging area. A `field-draft`
revision is applied locally immediately and marked pending central approval; it is the
central DB's review that is authoritative (see README "commits are reviewed centrally
before publication"). Until that review happens, the field laptop is operating on data
that has not been through change control.

### 3.3 Recommended retention posture (assumption / TODO)

The code does not encode any retention period, legal-hold, or export-for-discovery
capability. **Assumption:** FWT certificates for commissioned industrial equipment are
likely to be relied on for the service life of the asset and should be retained
accordingly. This needs a policy decision and is not currently enforced by the tool.

---

## 4. E-signature and the contenteditable signature fields

The word "signed" in "signed certificate" should be read carefully. What the product
actually implements is **typed names in editable fields, printed to paper or exported**.

- The certificate has `contenteditable` fields for the test engineer name
  (`09_report.js` line 89), the Section 2 result cells (lines 95–99), and three
  sign-off blocks — Vendor Representative, Commissioning Agent (CxA), Owner/GC
  Representative (lines 124–126). Each sign-off block prints a literal
  `Signature / date: ____________` line for a wet-ink signature.
- **UX-7 (Round 3)** gave these fields a visible editable affordance and focus ring
  (`09_report.js` lines 56–60) so testers can see they are meant to type into them.

What this means legally:

- There is **no cryptographic signature, no signer authentication, and no binding of a
  signer's identity to the document.** A name in a `contenteditable` box is free text
  that anyone can type or change. It does not satisfy the technical controls people
  usually mean by "e-signature" (e.g. a bound identity, an audit of who signed and
  when, tamper-evidence).
- The exported HTML / JSON / CSV artifacts (`09_report.js` lines 173–175) are ordinary
  files. After export they can be edited freely — including the names, the values, and
  the verdict — with no detectable trace. The printed PDF is likewise not sealed.
- **Do not describe WitnessONE certificates externally as "digitally signed" or
  "e-signed."** The honest description is: a generated FWT report with hand-entered
  sign-off names and a space for wet-ink signatures. If a true e-signature is required
  by a customer or standard, it is a gap that must be closed before making that claim.

---

## 5. Security posture of a localhost Agent that can WRITE to industrial equipment

This is the highest-consequence area. The Agent exposes `POST /modbus/write`, which
issues a **Modbus function code 06 (write single holding register)** to real
industrial equipment (`witnessone_agent.py` lines 753–761; the write itself in
`Modbus.write_reg`, FC06). Writing the wrong register on a live CDU, UPS, or breaker
is a physical-safety event, not just a data event.

### 5.1 What is defended

- **Anti-DNS-rebinding Host check.** Every request runs through `_guard()`
  (`witnessone_agent.py` line 552, invoked at the top of `do_GET` and `do_POST`). It
  rejects any request whose `Host` header is not a loopback name (403, "possible DNS
  rebinding"). This is origin-independent and is described in the code as the
  "backbone" defense.
- **Cross-origin lockdown (SEC-1 / SEC-3 / SEC-6, Round 2).** A foreign `http(s)`
  origin is blocked; `Access-Control-Allow-Origin` is never `*` — only a localhost
  origin or the `null` origin is ever reflected (`_allowed_origin`, lines 526–551).
  CORS preflight is only satisfied for allowed origins (`do_OPTIONS`, lines 590–595),
  so a browser on `evil.com` cannot read the Agent's responses or complete a preflight
  for a write. A Referer fallback blocks cross-origin requests that omit Origin
  (lines 565–572). This closes the drive-by CSRF-write and SSRF-internal-scan vectors.
- **TLS verification on outbound calls (SEC-4, Round 2).** The Agent verifies TLS when
  it forwards to TOP Server or syncs the remote registry; verification is disabled
  **only** if the operator explicitly passes `--insecure-tls`, never silently
  (`_ssl_ctx`, lines 185–194). This protects forwarded TOP Server credentials and the
  integrity of synced registry templates from an on-path attacker.
- **Stored XSS closed (SEC-2, Round 2).** Registry-sourced strings are HTML-escaped on
  render (`esc()` in `09_report.js` line 6, used throughout the table rendering), so a
  malicious model/firmware string in a vendor template cannot inject script into the
  certificate view. `build.py` also escapes `</script>` when embedding vendor JSON
  (BP-1).

### 5.2 The documented file:// trade-off (residual, accepted)

WitnessONE's primary zero-install field mode is "open `dist/WitnessONE.html`
directly." A page opened from `file://` sends `Origin: null`. Round 2's origin guard
rejected `null`, which broke that workflow and made the UI silently fall back to
simulation. Commit `4f26c2d` re-admitted the literal `null` origin
(`_allowed_origin` lines 543–544).

The accepted, documented cost: allowing `null` also admits **other** null-origin
contexts — sandboxed iframes and `data:` URLs. The code is explicit that this is a
"bounded, documented trade-off" and that the Host-header check remains the real
anti-rebinding defense (lines 536–539). From a legal standpoint this is a
consciously-accepted residual risk, which is the defensible way to hold it, but it
should be named in any security representation made to a customer rather than implied
away.

### 5.3 What is NOT defended (the important gap)

- **There is no authentication or authorization on the Agent API.** The guard stops a
  *remote browser*; it does not stop a *local* actor. Any process on the laptop, or any
  page served from localhost, can call `POST /modbus/write` and command an FC06 write
  to connected equipment. The per-session token intended to close this
  (SEC-1/SEC-6 follow-up) is documented as **deferred** — it "needs the served UI" and
  is not implemented in this branch (`ee91d2f` message, "Partial" section).
- **Write "arming" is client-side only.** The UI arms writes before issuing them (the
  qa4 suite arms writes before asserting the FC06 landed), but the Agent endpoint
  itself performs no arming, confirmation, allow-list of writable registers, or
  value-range check beyond "address must be a holding register" (line 755). A caller
  that skips the UI faces no server-side guardrail on what register or value it writes.
- **No write audit trail.** Reads/records are archived (§3), but FC06 writes are only
  printed to the Agent's console log (`log_message`, line 589). There is no persistent,
  attributable record of who wrote what value to which register when. For a capability
  that can move a physical setpoint, the absence of a write log is a notable gap.

**Bottom line for §5:** the network-facing posture is now reasonable for a localhost
tool, but the trust model is "anyone with local access is fully trusted, including to
command physical writes." That is an acceptable posture only if physical control of the
commissioning laptop is itself controlled, and it should be stated as an operating
assumption, not left implicit.

---

## 6. Third-party / vendor data provenance and attribution

The device library is built from **vendor points-list workbooks** (Equinix-held
Excel/CSV point maps for each asset) via `tools/parse_points.py`, then split into the
v2 registry (`devices/<id>.json` for identity, `pointslists/<id>/<rev>.json` for the
SPL revision). The certificate prints vendor **make / model / firmware** identifiers
drawn from that registry.

Provenance and attribution considerations:

- **Embedded vendor identifiers.** The registry stores and the certificate displays
  manufacturer, model, and firmware strings (e.g. VERTIV XDU1350B, Delta
  UPS125DM88A04D9, ABB Emax2, Schneider PM8000). These are third-party trademarks and
  model identifiers used to describe the asset under test. **Assumption:** descriptive
  use for a genuine acceptance test is normal, but the product should not imply vendor
  endorsement or certification *by* those manufacturers — WitnessONE certificates are
  Equinix commissioning records, not manufacturer certifications.
- **Documented, incomplete provenance (DATA-8, Round 3).** CDU point provenance is now
  documented, but the code and commit message record that **14 legacy "DCOS" marker
  strings on address-less rows remain and are non-regenerable without the original
  workbook.** So a portion of one asset's point metadata cannot currently be traced
  back to a source workbook. This is a known data-lineage gap.
- **Silent data loss made explicit (DATA-7, Round 3).** The PM8000 curated-set point
  drop is now explicit and logged rather than silent, so it is visible that the shipped
  points-list is a curated subset of the vendor workbook, not the full sheet.
- **Untrusted vendor content is treated as untrusted.** Because vendor strings flow
  into the rendered certificate, they are escaped on render (SEC-2) and when embedded at
  build time (BP-1). Vendor-supplied text is correctly treated as data, not code.
- **Change control on vendor data.** Approved SPL revisions are immutable on the laptop
  (DATA-2, Round 2; `save_revision` refuses to overwrite an `approved` revision,
  `witnessone_agent.py` lines 166–175, and `POST …/pointslists` returns 409 for an
  approved status, lines 794–797; locked in by the qa10 immutability suite). Field
  changes fork a clearly-labeled `field-draft` revision. This means the vendor-derived
  witness-of-record cannot be quietly altered in the field — a genuine integrity
  strength worth keeping.

---

## 7. Prioritized risk register

Ordered by combined likelihood × impact. "Current mitigation" cites what the code
already does; "residual action" is what is still open.

| # | Risk | Likelihood | Impact | Current mitigation in code | Residual action |
|---|------|-----------|--------|----------------------------|-----------------|
| R1 | **Erroneous FC06 write to live equipment** by a local process/page bypassing the UI, causing a physical-safety event | Low–Med | Critical | `_guard()` blocks remote drive-by writes; FC06 restricted to holding registers (`agent` L753–761); UI-side arming | Server-side write arming/confirmation, writable-register allow-list, value-range checks, and a persistent write audit log; per-session auth token (deferred SEC-1/6) |
| R2 | **False PASS / wrong value on a certificate** relied on for equipment acceptance | Low (post-fix) | Critical | CERT-1/3/4 verdict + comms derived from real results (`09_report.js`); LIVE-1/DATA-1 correct 32-bit & bit-mapped decode (`05b_live.js`); DATA-6 range semantics | Capture real serial on connect form (open TODO); add end-to-end value-verification checks in QA for every asset class |
| R3 | **Simulated run passed off as live** acceptance evidence | Med | High | LIVE-2 honest data-source statement + link-loss BAD-quality behavior (`09_report.js` L135–139, `05b_live.js` L177–182) | Tamper-evident export (seal/hash) so the provenance line cannot be edited post-export; a visible SIMULATED watermark on the printed page |
| R4 | **"Signed" certificate has no real signature**, names/verdict editable after export, no tamper evidence | High | High | Wet-ink signature line + visible editable name fields (UX-7); in-app values escaped (SEC-2) | Do not market as "e-signed"; if required, add cryptographic signing / hash-seal on export and an attributable signer identity |
| R5 | **Records store is not a tamper-evident audit log** — local, unencrypted, directly editable SQLite; loss on laptop failure | Med | High | Append-only INSERT path, no update/delete endpoint (`agent` L762–769) | Central certificate vault (Stage 3), at-rest encryption or hashing/chaining of rows, defined retention & legal-hold policy |
| R6 | **Unreviewed field-draft data used in the field** before central change control | Med | Med | Immutable approved revisions (DATA-2, qa10); drafts clearly labeled and stamped "pending approval"; `pending_commits` queue | Enforce that certificates run against a field-draft are visibly flagged as provisional to downstream parties |
| R7 | **file:// null-origin trade-off** admits sandboxed-iframe / data: URL contexts to the Agent | Low | Med | Host-header check remains origin-independent backbone (`agent` L536–539) | Disclose the trade-off in any security representation; revisit if a served-UI-only mode becomes the default |
| R8 | **Vendor data lineage incomplete** (14 non-regenerable DCOS markers; curated PM8000 subset) | High (exists now) | Low–Med | DATA-7/DATA-8 make the gaps explicit and logged; vendor strings escaped (SEC-2, BP-1) | Re-source the original workbooks to restore full lineage; record subset-vs-full status on the certificate |
| R9 | **TLS downgrade** exposing TOP Server credentials / poisoning synced templates | Low | High | TLS verified by default; opt-out only via explicit `--insecure-tls` (`agent` L185–194) | Warn loudly (or log to record) whenever `--insecure-tls` is active during a real run |
| R10 | **Trademark / endorsement implication** from embedded vendor make/model/firmware | Low | Low–Med | Certificate framed as Equinix commissioning record | Confirm descriptive-use framing; avoid any wording implying manufacturer certification |

---

## 8. Summary for sign-off

The three review rounds materially improved the two things Legal cares about most: the
**verdict and the values on the certificate are now derived from real results**
(CERT/LIVE/DATA fixes) rather than fabricated, and the **network attack surface of the
write-capable Agent is closed against remote browser drive-by** (SEC fixes), with the
one file:// trade-off consciously documented.

The remaining exposure is concentrated in three places, and none of them is closed in
this branch:

1. **The Agent has no local auth and no server-side guardrail on physical writes** (R1).
2. **The certificate is not a signed or sealed document** — names and verdict are
   freely editable after export, and there is no real e-signature (R4).
3. **The records store is a local convenience archive, not a tamper-evident, retained
   audit trail**, and field-draft data can be used before central review (R5, R6).

These three should be resolved, or explicitly accepted in writing by the product owner
with the operating assumptions named (physical control of the laptop; "report" not
"signed certificate"; retention handled out-of-band), before WitnessONE certificates
are relied on by third parties as formal acceptance records.
