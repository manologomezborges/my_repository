# WitnessONE — Codebase Map (v0.7.1)

*~6,100 lines of hand-written code, zero runtime dependencies. Engineered by MG.*

## The one-minute picture

```
Equinix SPL workbooks (.xlsx)
        │  tools/parse_points.py          (workbook → template v1 JSON)
        ▼
templates/*.json  ──►  tools/split_registry.py  ──►  devices/*.json  +  pointslists/<id>/<rev>.json
                                                     (identity)         (ONE FILE PER SPL REVISION)
        ┌────────────────────────────────────────────────┘
        ▼  build.py  (embeds registry v2, concatenates src/app in load order)
dist/WitnessONE.html   ◄── the single-file FIELD EDITION (double-click, works offline)
        ▲
        │ served at http://127.0.0.1:5710/ by
agent/witnessone_agent.py   ◄── the LAPTOP AGENT: raw Modbus TCP driver, registry store,
        │                        records DB, TOP Server proxy, demo emulators
        ▼ raw Modbus TCP (FC02/03/04/06, MBAP over one persistent socket)
the asset (CDU / UPS / ACB / DX / PQM)         — or —      TOP Server Config API + IoT Gateway
```

## Repository layout

| Path | Lines / size | Role |
|---|---|---|
| `build.py` | 56 | Assembler: embeds registry v2 → generates `03_registry.js` → concatenates `src/app/*` into `dist/WitnessONE.html` |
| `src/app/` | ~3,600 | The UI, split into load-ordered modules (below) |
| `agent/witnessone_agent.py` | 809 | Local Agent (stdlib-only): Modbus driver, registry v2 store + migration, SQLite records, CORS proxy, demo devices, serves the UI |
| `devices/` + `pointslists/` | 5 + 5 files | **Registry v2** — device identities + selectable SPL revisions (approved = immutable; field drafts fork beside them) |
| `templates/` | 5 files | Legacy v1 parser output (auto-migrated by agent; kept as pipeline intermediate) |
| `tools/parse_points.py` | 232 | Generalized SPL workbook parser (5-digit, 6-digit, bit-mapped, FLOAT32 dialects) |
| `tools/split_registry.py` | 51 | v1 template → v2 devices + pointslists splitter |
| `qa/` | 12 suites | Playwright end-to-end + `modbus_device_sim.py` (real Modbus TCP XDU1350B emulator, port 1502) |
| `packaging/` | 4 files | `run_agent.bat` (layout-agnostic launcher) · `make_portable_bundle.bat` (zero-install builder) · `build_windows_exe.bat` (PyInstaller) · portable doc |
| `dist/` | — | Build output + `witnessone_mock_topserver.py` (Config API mock, port 57418) + architecture/QAQC HTML |
| `docs/` | — | Product one-pager, this map |

## `src/app/` modules — in build (= browser load) order

| # | File | Lines | Owns | Key globals it defines |
|---|---|---|---|---|
| 01 | `01_head.html` | 366 | Design tokens, all CSS (dark + orange, focus rings, reduced-motion-safe) | — |
| 02 | `02_body.html` | 376 | Every DOM element: boot card, topbar, panels, test deck, 9 modals | — |
| 03 | `03_registry.js` | *generated* | Embedded registry v2 payload + bootstrap working copy | `W1_REGISTRY_EMBEDDED`, `W1_ACTIVE_TEMPLATE`, `SPL_DB` |
| 04b | `04b_registry.js` | 156 | Registry client: v2 load/normalize, **revision select/fork/save**, agent link | `REGISTRY`, `W1AGENT`, `W1_SPLFMT` |
| 05 | `05_sim.js` | 283 | CDU physics model + generic plausible-value simulator, per-revision rebind | `SIM` |
| 05b | `05b_live.js` | 250 | LIVE link: TOP Server Config API client, IoT Gateway, **agent poll bridge**, armed-write gate | `LIVE` |
| 06 | `06_scene.js` | 901 | Custom canvas 3D engine: per-class exteriors (CDU/UPS/ACB/DX/PQM), decals, particles, cable motes, x-ray | `SCENE` |
| 07 | `07_ui.js` | 348 | Tiles, trend chart, points table, detail pane, bench wiring, safe chip | `UI` |
| 08 | `08_test.js` | 543 | FWT scripted suite (FWT00–10 + generic) + **witnessed state machine** (arm→trigger→confirm→recover) | `FWT` |
| 09 | `09_report.js` | 150 | Level-1 certificate (HTML/CSV/JSON exports, revision + draft stamp) | `REPORT` |
| 09b | `09b_help.js` | 90 | Help modal content (7 tabs) | `HELP` |
| 09c | `09c_flow.js` | 152 | Architecture flowchart (self-contained SVG) | `FLOW` |
| 10 | `10_boot.js` | 482 | Boot: catalog + **SPL revision selector**, register sweep UI, add-register→draft flow, SIM/LIVE connect, keyboard layer | wiring only |
| 11 | `11_tail.html` | 2 | Closing tags | — |

**The one shared contract:** `window.SPL_DB` is the *working copy* of the selected
points-list revision. `REGISTRY.setActive(deviceId, revId)` repopulates it in place
(never swaps the reference — every module captured it at load). `SIM`, `LIVE`, `SCENE`,
`UI`, `FWT`, `REPORT` all read from it; only the add-register flow writes to it, and
`REGISTRY.snapshotDraft()` serializes it back into a draft revision file.

## Agent API surface (localhost:5710)

`/agent/status` · `/registry/devices` (v2: devices + pointslists) ·
`/registry/devices/{id}/pointslists` (save draft; approved = 409) ·
`…/verify` `…/propose` (queue → central DB) · `/registry/sync` ·
`/modbus/discover|scan|read?template&rev|write` (FC06, holding only) ·
`/records/runs` (SQLite) · `/proxy/config/* /proxy/iot/*` (CORS-free TOP Server)

The **Modbus driver** is the `Modbus` class in the agent: raw MBAP frames over one
persistent locked socket; `addr_split` (SPL address → FC + offset), `cluster`
(sparse registers → few block reads), gentle sweep (12-reg chunks, 40 ms gaps).

## QA map

`qa1/qa2` sim + full CDU FWT · `qa3` TOP Server vs mock · `qa4/qa5` agent app modes ·
`qa6` field workflow (sweep, SAFE gate, witnessed W06, records) · `qa7` front page ·
`qa8` direct-live · `qa9` 3D models · Suite H (revision/draft model) — all headless,
zero-console-error gate. `modbus_device_sim.py` = real Modbus TCP emulator incl. the
undocumented 30021 register for the new-firmware demo.

## "If you want to change X, touch Y"

| Change | Touch |
|---|---|
| Add an asset | Drop workbook → `tools/parse_points.py` → `tools/split_registry.py` → `python build.py` (no code) |
| New SPL revision for a device | New file in `pointslists/<id>/` (central DB will publish these) |
| 3D look of a class | `06_scene.js` — `buildMeterAsset` / `buildBreakerAsset` / `buildGenericInterior` / decal fns |
| Test script steps | `08_test.js` — `TESTS` array / `genericWSteps` |
| Certificate wording | `09_report.js` — `paperHTML` |
| Connect-screen flow | `02_body.html` + `10_boot.js` (`liveConnect`, `fillCatalog`) |
| Modbus behavior / safety | `agent/witnessone_agent.py` — `Modbus`, `cluster`, `scan_registers` |
| Colors / spacing / type | `01_head.html` `:root` tokens |
