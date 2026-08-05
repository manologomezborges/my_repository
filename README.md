# WitnessONE — Universal FWT Commissioning Toolbox

*One plug. Every asset. Certified.* · Engineered by **MG** · Equinix Commissioning

Plug a laptop into any factory-witness-test asset, watch it live as a 3D digital
twin, run the Level-1 script, walk out with a signed certificate. This repo is
the v0.3.0 architecture: a template-driven web UI plus a local Agent service.

## Repository layout

```
build.py                     assembles the single-file FIELD EDITION → dist/WitnessONE.html
src/app/                     UI modules (concatenated in build order; zero runtime deps,
                             custom canvas 3D engine — works fully offline)
devices/ + pointslists/      REGISTRY v2: device identities + SPL REVISIONS (see schema)
templates/*.json             legacy v1 parser output (auto-migrated by the Agent)
agent/witnessone_agent.py    local Agent: real Modbus TCP, registry sync, records, proxy
qa/                          Playwright end-to-end suites + a real Modbus TCP device
                             emulator of the XDU1350B (qa/modbus_device_sim.py)
dist/                        build output + witnessone_mock_topserver.py (Config API mock)
```

## Quick starts

**Field edition only (zero install):** open `dist/WitnessONE.html`. Simulation
mode is fully self-contained. LIVE mode expands into a link choice: **Direct
Modbus** (default — via the Agent, no middleware) or **TOP Server** (Config API
+ optional IoT Gateway; CORS required when browser-direct, or use the Agent proxy).

**With the Agent (recommended):**
```
python3 agent/witnessone_agent.py            # port 5710; add --remote / --topserver / --iot
```
The UI auto-detects the Agent and unlocks: real Modbus discovery/fingerprinting,
Direct-Modbus live values (no IoT Gateway license needed), template registry
sync, SQLite test-record archive, and CORS-free TOP Server proxying at
`/proxy/config/*`.

**No hardware handy:** `python3 qa/modbus_device_sim.py --port 1502` gives you a
real Modbus TCP XDU1350B (FC02/03/04/06) — discover 127.0.0.1:1502.
`python3 dist/witnessone_mock_topserver.py` gives you a mock Config API on 57418.

**Build after editing:** `python3 build.py` (stdlib only — no npm needed).

## Registry schema v2 — devices + SELECTABLE points-list revisions

The SPL is a first-class, versioned artifact: one device can be witnessed
against **v4.17, v4.18, … or SPL 1.0** — the tester picks the revision on the
connect screen.

```
devices/<id>.json               witnessone.device/2 — identity (make/model/fw),
                                layout, fwtScript, registry meta, defaultPointsList
pointslists/<id>/<rev>.json     witnessone.pointslist/2 — ONE FILE PER SPL REVISION:
                                revId, splVersion, status (approved|field-draft),
                                appliesToFw[], basedOn, spl{points…}
templates/<id>.json             legacy v1 (kept as parser output; auto-migrated)
```

Approved revisions are IMMUTABLE on the laptop. A field change (new register,
new firmware behaviour) forks a **FIELD DRAFT** revision file next to the
approved one — the draft is selectable, clearly labeled, polled live, stamped
on the certificate as pending approval, and queued as a commit for the central
DB, which publishes it as the next approved revision. Pipeline:
`tools/parse_points.py` (workbooks → v1) → `tools/split_registry.py` (v1 → v2)
→ `python build.py`.

## Central registry DB — API contract (for the platform team)

The Agent syncs templates against a remote registry when started with
`--remote <base-url>`. The workflow, exactly as used in the field: **pull**
updated make/model/fw/SPL; field engineer sees a change → **push a commit**;
everything matches → just **touch the verification date**.

```
GET   /devices                     → { "templates": [ DeviceTemplate, … ] }     # pull all (v1 wire format)
GET   /devices/{id}                → DeviceTemplate                             # pull one
PATCH /devices/{id}/verify         { "date": "YYYY-MM-DD", "by": "MG" }         # touch last-checked
POST  /devices/{id}/commits        { "by", "note", "revId"?, "rev"?, "template"? }  # propose (field-draft revision)
```

Rules: `registry.version` is semver, bumped by the DB on accepted commits;
`registry.lastVerified`/`verifiedBy` updated by PATCH; commits are reviewed
centrally before publication (the Agent queues verify/propose locally in
`pending_commits/` when offline or when no remote is configured, so nothing is
lost in the field).

## Agent API (localhost:5710)

```
GET  /agent/status                          heartbeat + capability flags
GET  /registry/devices                      devices + pointslists (+legacy templates)
POST /registry/devices/{id}/pointslists     save a FIELD-DRAFT SPL revision (approved = immutable)
POST /registry/devices/{id}/verify|propose  field workflow (syncs/queues; propose carries the draft)
POST /registry/sync                         pull from --remote
POST /modbus/discover  {hosts,port,unit}    real TCP scan + register fingerprint
GET  /modbus/read?template&rev&ip&port&unit block reads of the SELECTED revision → {addr:value}
POST /modbus/write     {ip,port,unit,addr,value}   FC06 (holding registers only)
GET/POST /records/runs[/{id}]               SQLite witness-test archive
ANY  /proxy/config/* · /proxy/iot/*         CORS-free TOP Server forwarding
```

## Verified by CI (Playwright, headless)

Sim mode end-to-end · TOP Server Config API mode against the mock (browse,
provision 32 tags, 207 handling, live gateway values, guarded write, doctor
fallback) · Agent mode against a real Modbus TCP emulator (discovery match,
direct live telemetry, FC06 write confirmed device-side, record archived,
certificate carries the live data-source statement).

## Roadmap

Stage 3: central registry DB + certificate vault + cross-FWT dashboards (SSO).
Agent: OPC UA client for TOP Server live values, packaged .exe, more drivers.

## Device library (v0.7.0 — 5 assets · 5 approved SPL revisions)

VERTIV XDU1350B CDU (26 pts) · Delta UPS125DM88A04D9 (66 pts) · ABB Emax2
LV breaker (25 pts, bit-mapped status) · DX Unit Type 3 (36 pts) ·
Schneider PM8000 power meter (25 pts, FLOAT32). Each parsed from its Equinix
points-list workbook by `tools/parse_points.py` into a versioned template JSON.
Adding an asset = drop its workbook in, run the parser, `python build.py`.
