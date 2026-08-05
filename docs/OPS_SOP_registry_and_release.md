# SOP: SPL Revision Workflow and Cutting a Release

Owner: Ops · Applies to: this repository (WitnessONE)
Related: `docs/OPS_POSTMORTEM.md` (why these two workflows are the riskiest
in the codebase — DATA-2 approved-revision immutability and the QA suite
that used to pass regardless of correctness)

These are the two workflows in WitnessONE where a mistake either corrupts
the witness-of-record data (an approved SPL revision) or ships a build that
looks fine but is silently wrong on a certificate. Follow both procedures
exactly; do not shortcut steps 2-3 of either one.

---

## Procedure 1 — Proposing and approving an SPL points-list revision

### Ground rule

An **approved** points-list revision (`pointslists/<device-id>/<revId>.json`
with `"status": "approved"`) is the witness-of-record contract for that
device/firmware. It is enforced immutable **on the laptop** by the Agent at
two independent points:

- `save_revision()` in `agent/witnessone_agent.py` (line ~166) refuses to
  overwrite a file on disk whose existing `status` is `"approved"`.
- Both HTTP write paths route through `save_revision()`:
  `POST /registry/devices/{id}/pointslists` returns `409` outright if the
  request body itself claims `"status": "approved"` (line ~794), and
  `POST /registry/devices/{id}/propose` — even when it receives a legacy v1
  `template` body — forces the derived revision's status to `"field-draft"`
  and gives it a synthetic `revId` (`<slug>-field-<timestamp>`) before
  saving, so it can never masquerade as the approved file (line ~810-816).

This is the exact guarantee `qa/qa10_immutability.py` (Suite H) checks
against an isolated copy of the registry on every QA run. **Never** hand-edit
a file in `pointslists/<id>/` that has `"status": "approved"` — there is no
supported path for that, and doing it defeats the guarantee the rest of the
system (and the certificate) relies on.

### A. Field engineer proposes a change (new register, new firmware behavior)

1. In the running UI (`dist/WitnessONE.html`, connected to the local Agent),
   select the device and its current active revision.
2. Fork a field draft: `REGISTRY.forkDraft(deviceId)`
   (`src/app/04b_registry.js`). This creates a new in-memory revision object:
   - `revId`: `<currentRevId>-fld-<YYYYMMDD>`
   - `status`: `"field-draft"`
   - `basedOn`: the current (approved) `revId`
   - `approvedBy` / `approvedDate`: `null`
   - `spl.points`: a snapshot of the current working point list, which the
     field engineer then edits (e.g. via the add-register flow in
     `src/app/10_boot.js`).
   The draft becomes the active revision in the UI; the underlying approved
   revision file is never touched by this step — it only exists in memory
   plus, once saved, as a new sibling file.
3. Save the draft to the Agent: `REGISTRY.saveDraft(deviceId)`. This calls
   `REGISTRY.snapshotDraft()` to pull the current working copy back into the
   revision object, then `POST /registry/devices/{id}/pointslists` with
   `{"rev": <the draft revision>}`. Requires the Agent to be running
   (`AGENT.present`) — there is no offline-save path in the UI. On success,
   the Agent writes `pointslists/<id>/<revId>.json` on disk with
   `status: "field-draft"`.
4. The draft is now selectable on the connect screen alongside the approved
   revision, is clearly labeled as a draft, is polled live like any other
   revision, and is stamped on any certificate generated against it as
   pending approval (per `README.md`'s registry-schema section).

### B. Recording that a device was checked with no changes

If the field engineer reviewed a device against its currently approved
revision and found no drift, do **not** fork a draft. Call
`REGISTRY.verify(deviceId, by)`, which:

- `POST /registry/devices/{id}/verify` with `{"by": <engineer>}`
- The Agent updates `registry.lastVerified` / `registry.verifiedBy` on the
  device's own `devices/<id>.json` (not the points-list — verification
  touches identity metadata, never the SPL) and, if `--remote` was passed at
  Agent startup, also does `PATCH <remote>/devices/{id}/verify` to push the
  same touch centrally; if there's no remote configured or it's unreachable,
  the response comes back with `"queued": true` and nothing is lost.

### C. Publishing a proposed change to the central registry

1. Call `REGISTRY.propose(deviceId, note, by)`. This:
   - `POST /registry/devices/{id}/propose` with the active revision's
     current snapshot (via `snapshotDraft()` if it's a field-draft; `null`
     if the active revision is already approved and nothing changed).
   - The Agent persists the draft locally the same way step A.3 does (still
     subject to the same immutability guard), writes a queued-commit record
     to `agent/pending_commits/<device-id>-<timestamp>.json` (gitignored —
     this is laptop-local state, not repo state), and — if `--remote` is
     configured — also does `POST <remote>/devices/{id}/commits` with the
     same payload.
   - If the remote is unreachable or unconfigured, the response reports
     `"queued": true`; the commit sits in `pending_commits/` until the Agent
     is later run with `--remote` against a reachable registry DB and syncs.
2. **Central review and publication happen off the laptop**, on the
   platform-team side of the API contract documented in `README.md`
   ("Central registry DB — API contract"). WitnessONE's Agent and UI have no
   code path that marks a revision `approved` locally — that status only
   ever arrives via a pulled file. This is intentional: it's what makes the
   "approved = immutable on the laptop" guarantee hold.
3. Once the central DB publishes the new approved revision, laptops pick it
   up via `POST /registry/sync` (`--remote` must be set at Agent startup),
   which does `GET <remote>/devices`, and for each returned template calls
   `save_template()` → `save_revision()` — the same guarded write path as
   everything else, so a sync can add a new approved revision file but still
   cannot silently overwrite an existing one in place.

### D. Verification before trusting a revision change landed

Run `python3 qa/qa10_immutability.py`. It stands up the Agent against a
throwaway copy of the registry (never the repo's own `devices/`/`pointslists/`)
on port 5711 and asserts:

- `POST /registry/devices/{id}/pointslists` with `status: "approved"` in the
  body returns `409`.
- `POST /registry/devices/{id}/propose` with a legacy v1 `template` body
  does not shrink or overwrite the approved revision's on-disk point count.

If this suite ever fails, treat it as a stop-the-line event — it means the
approved-revision guarantee (`DATA-2` in the postmortem) has regressed.

---

## Procedure 2 — Cutting a release

The pipeline, in the order the code actually enforces (`README.md`'s
"Pipeline" line and `docs/CODEBASE_MAP.md`'s "if you want to change X" table
agree with this): `tools/parse_points.py` → `tools/split_registry.py` →
`python3 build.py` → all 10 QA suites → tag.

### 0. Only if adding or updating a device's source points list

`tools/parse_points.py` is **not** a generic "point it at any workbook"
CLI — read it before assuming otherwise. It takes one optional argument (the
uploads directory containing the vendor `.xlsx` workbooks; it defaults to a
hardcoded path from the original import) and then runs a **fixed sequence of
per-device parse calls**, each hardcoded to a specific workbook filename
(e.g. `UP + 'b62da3d6-Delta_UL_Model_UPS125DM88A04D9_...xlsx'`) and specific
sheet/header-row parameters. Adding a sixth device or re-parsing an existing
one's updated workbook currently means **editing `tools/parse_points.py`** to
add or adjust its dedicated parse block — it is not a no-code drop-in step,
despite `docs/CODEBASE_MAP.md`'s "if you want to change X" table describing
asset addition as "no code." Treat that doc line as aspirational until the
parser is generalized; until then, budget code-review time for changes to
`tools/parse_points.py` itself.

```
python3 tools/parse_points.py <path-to-workbook-directory>
```

Writes `templates/<device-id>.json` (schema `witnessone.device-template/1`,
the legacy v1 format) for each device it's coded to handle. Watch stderr for
its own integrity warnings — e.g. the PM8000 curated-set block prints which
of its wanted points had no usable register row and were dropped.

### 1. Split v1 templates into the v2 registry layout

```
python3 tools/split_registry.py
```

Reads every `templates/*.json`, and for each writes:

- `devices/<id>.json` (schema `witnessone.device/2`) — identity, layout,
  `fwtScript`, and registry metadata (`version`, `lastVerified`,
  `verifiedBy`, `source`, `complianceStatus`), plus `defaultPointsList`
  pointing at the revision below.
- `pointslists/<id>/<revId>.json` (schema `witnessone.pointslist/2`) — the
  full SPL, with `status` **hardcoded to `"approved"`** and `revId` derived
  by slugging `registry.splVersion` (e.g. `"4.17"` → file `4.17.json`).

`split_registry.py` always emits `status: "approved"`. This is correct for
the parser pipeline (a re-parsed workbook is, by definition, the source of
truth being republished) but means running it against a workbook that hasn't
actually been through central review will mint a new "approved" file on the
laptop. Confirm the workbook is the reviewed, sign-off version before running
this step — there's no interactive confirmation in the script.

### 2. Build the single-file field edition

```
python3 build.py
```

This regenerates `src/app/03_registry.js` from every `devices/*.json` +
`pointslists/<id>/*.json`, then concatenates the modules in `build.py`'s
`ORDER` list into `dist/WitnessONE.html`. Before writing, `gen_registry()`
runs guardrails that will **fail the build** or **downgrade a revision** —
both are load-bearing for a release and worth understanding, not just
trusting:

- `validate_rev_fcs()` checks every point's declared `readFC`/`writeFC`
  against the Modbus table implied by its address (the same rule the Agent
  applies at runtime in `validate_point_fcs()`). A mismatch prints a `WARN`
  and, if the revision is `status: "approved"`, **coerces it to
  `"field-draft"` in the generated bundle** — a build-time enforcement of
  the same "bad data can never ship as approved" rule Procedure 1 enforces
  at the Agent's HTTP layer. Any `field_derived` revision (one with a
  non-null `basedOn`) is coerced the same way regardless of FC validity —
  an "approved" file can never legitimately have `basedOn` set.
- If a device's `registry.pointCount` is declared, the build **asserts**
  (hard failure, not a warning) that the approved revision's point count
  matches it — this catches a curated set silently gaining or losing points
  on regeneration (the postmortem's DATA-7).
- Vendor free-text fields are escaped (`</` → `<\/`) before being embedded in
  the inline `<script>` block, so a value like `</script>` in a workbook
  comment can't break the generated single-file HTML (BP-1).

On success it prints the device count, revision count, and output size, and
writes `dist/WitnessONE.html`. **Read the console output.** A `WARN` you
don't recognize means a revision you expected to ship as approved just got
silently downgraded to `field-draft` in the build — that changes what the
UI will label it and what a certificate generated against it will say.

### 3. Run all 10 QA suites

There is no single test runner in the repo (no `pytest.ini`, no CI workflow
that runs them — `packaging/ci_build_agent.yml` only builds the Windows
Agent `.exe`, it does not run QA). Each suite is a standalone script; run
each and check its exit code (`0` = pass, `1` = at least one check failed —
every suite calls `sys.exit(1)` on failure and prints which named checks
failed).

```
python3 qa/qa1.py                # Sim mode end-to-end (CDU)
python3 qa/qa2.py                # Full CDU FWT script + certificate export
python3 qa/qa3_live.py           # TOP Server Config API mode vs the mock (dist/witnessone_mock_topserver.py)
python3 qa/qa4_agent.py          # Agent mode: real Modbus TCP discovery + direct-live + armed FC06 write
python3 qa/qa5_app.py            # Agent-served app mode
python3 qa/qa6_field.py          # Field workflow: sweep, SAFE gate, witnessed W06, records archive
python3 qa/qa7_frontpage.py      # Front page / points table
python3 qa/qa8_livedirect.py     # Direct-live telemetry path
python3 qa/qa9_models.py         # 3D twin renders for all 5 asset classes
python3 qa/qa10_immutability.py  # Approved-revision immutability (isolated registry copy)
```

Notes that matter operationally:

- Suites `qa3`–`qa6`, `qa8`, `qa10` spawn their own fixtures (the Modbus
  device emulator `qa/modbus_device_sim.py`, the mock TOP Server
  `dist/witnessone_mock_topserver.py`, and/or the Agent itself on a suite-
  specific port — `qa10` uses `5711` specifically so it can run alongside
  the others' `5710`) and tear them down on exit; you do not need to start
  the Agent or emulator by hand first.
- All suites derive paths from `__file__` and write artifacts to
  `qa/_artifacts/` (gitignored) — none of them touch tracked files anymore
  (this was itself one of the Round-3 fixes: `qa2` used to overwrite the
  tracked `qa/Sample_FWT_Certificate.pdf` on every run).
- These are Playwright scripts, not a pytest suite — they need
  `playwright` installed with the Chromium browser available
  (`pip install playwright && playwright install chromium`). This is an
  assumption based on standard Playwright setup; the repo does not carry a
  pinned `requirements.txt` or documented install step for QA dependencies,
  so confirm the environment has a working Playwright + Chromium before
  relying on a suite's PASS.
- Treat all 10 as required, not "run what's convenient." `qa10` is the only
  suite that verifies approved-revision immutability; `qa2` is the only one
  that exercises the full certificate export path end to end. Skipping
  either defeats the point of this checklist.

Do not tag a release on anything less than 10/10 green. Investigate and fix
before tagging — this was exactly the gap Round 3 closed (baseline was
0/9 suites meaningfully runnable; this branch's history is the record of
getting them to catch real defects).

### 4. Tag

Once `python3 build.py` is clean and all 10 QA suites pass:

```
git add -A
git commit -m "..."   # if the build/QA run produced tracked changes (e.g. dist/WitnessONE.html, generated src/app/03_registry.js)
git tag vX.Y.Z
git push --follow-tags
```

Two things to check before choosing `X.Y.Z`, both flagged in
`docs/OPS_POSTMORTEM.md`'s prevention actions:

- The repo does not have a single canonical version source today —
  `README.md` says "v0.3.0 architecture," `docs/CODEBASE_MAP.md` and
  `docs/PRODUCT_ONE_PAGER.md` say v0.7.0/v0.7.1, and the baseline import
  commit message says v0.8.2. Reconcile which one is authoritative (or add a
  `VERSION` file `build.py` stamps into the bundle) before picking a tag, so
  the tag isn't yet another disagreeing number.
- `dist/WitnessONE.html` is a build artifact but is tracked in git (it was
  part of the baseline import and every subsequent round diffs it). Decide,
  before tagging, whether the tag should include the freshly rebuilt
  `dist/WitnessONE.html` committed (matches how this repo has operated so
  far) — if so, step 2's `build.py` output must be committed before the tag,
  not just present on disk.
- Pushing a `v*` tag triggers `packaging/ci_build_agent.yml` (GitHub/Gitea
  Actions) if that workflow is installed under `.github/workflows/` in the
  environment you're releasing from — it runs `python build.py` again in CI
  and packages `agent/witnessone_agent.py` via PyInstaller into
  `dist/WitnessONE.exe` (the `--name WitnessONE` artifact — the workflow's own
  header comment still calls it `WitnessONE-Agent.exe`, but the file produced is
  `WitnessONE.exe`). Confirm the workflow file is actually deployed to
  `.github/workflows/` (the copy in `packaging/` is a template, not itself
  wired up) if you're relying on that artifact.
