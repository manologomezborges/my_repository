# WitnessONE — Operator Runbook

Scope: how to build, how to run every mode, how to run the QA suites (the way
that actually works in this environment), and how to read the common failure
messages. Grounded in the code and the git log on this branch as of commit
`4f26c2d` (see `docs/RELEASE_NOTES_v0.8.3.md` for what changed to get here).

Versions in the tree do not agree with each other (README says "v0.3.0
architecture", `docs/CODEBASE_MAP.md`/`docs/PRODUCT_ONE_PAGER.md` say
v0.7.0/v0.7.1, the Agent's `VERSION` constant is `"0.3.0"`, and the baseline
import commit calls itself "v0.8.2"). This is a known, tracked inconsistency
— see `docs/OPS_POSTMORTEM.md` prevention action 5. Don't use any single
version string in this repo as a source of truth for "what build is this."

## 1. Build

```
python3 build.py
```

stdlib-only, no npm/pip step. It reads `devices/*.json` + `pointslists/<id>/*.json`
(registry v2), generates `src/app/03_registry.js`, concatenates `src/app/*` in
the order listed in `build.py`'s `ORDER` list, and writes the single offline
file `dist/WitnessONE.html`. Confirmed working in this environment:

```
built dist/WitnessONE.html · 420571 bytes · 5 device(s) · 5 points-list revision(s)
```

`build.py` also runs two safety checks at build time (both added in the
Round 2/3 hardening — see release notes DATA-5/DATA-7):

- **FC/table validation** (`validate_rev_fcs`): for every point's address it
  derives the Modbus table the Agent will actually use (`hold`/`input`/`disc`/
  `coil`, from the address ranges in `_addr_kind`) and checks any declared
  `readFC`/`writeFC` against it. A mismatch, or a field-derived revision
  (`basedOn` set) marked `status: "approved"`, gets a `WARN` on stdout and the
  revision is coerced to `field-draft` so it cannot ship as approved.
- **Forward drift guard**: if a device JSON declares `registry.pointCount`,
  the approved revision's point count must match it exactly, or the build
  fails an `assert`.

Rebuild after any change under `src/app/`, `devices/`, or `pointslists/` —
`dist/WitnessONE.html` is a generated artifact, not something to hand-edit.

## 2. Run modes

### 2.1 Field edition, zero install (`file://`)

Just open the built file directly in a browser — no server, no install:

```
open dist/WitnessONE.html          # macOS
xdg-open dist/WitnessONE.html      # Linux
# or: double-click dist/WitnessONE.html in Explorer on Windows
```

This is the primary documented deployment. SIM mode is fully self-contained
(no network calls at all). LIVE mode needs either the Agent (Direct Modbus,
default) or TOP Server reachable from the browser.

A `file://` page sends the literal string `null` as its `Origin` header on
fetches. The Agent explicitly allows that (see section 5, "AGENT NOT
RUNNING") — if you're running an Agent build older than commit `4f26c2d`,
LIVE mode from `file://` will silently fall back to SIM.

### 2.2 With the Agent (recommended — real Modbus, registry sync, records)

```
python3 agent/witnessone_agent.py
```

Starts an HTTP server on `127.0.0.1:5710` (stdlib `ThreadingHTTPServer`, no
pip deps) that serves the UI at `/` (auto-resolves `dist/WitnessONE.html`
relative to the script, or via `--ui <path>`) and exposes the API described
in `README.md` / `docs/CODEBASE_MAP.md` (`/agent/status`, `/registry/devices`,
`/modbus/discover|scan|read|write`, `/records/runs`, `/proxy/config/*`,
`/proxy/iot/*`). Open either `http://127.0.0.1:5710/` (agent-served UI, same
origin, no CORS involved) or `dist/WitnessONE.html` via `file://` (the UI
auto-detects the Agent on `127.0.0.1:5710` via `REGISTRY.detectAgent()` in
`src/app/04b_registry.js`, polling `/agent/status` with an 800ms timeout).

Useful flags (`agent/witnessone_agent.py`, `argparse` block at the bottom of
the file):

| Flag | Purpose |
|---|---|
| `--port N` | HTTP port (default 5710) |
| `--headless` | don't try to open a browser app-window |
| `--demo-device` | start the built-in XDU1350B Modbus emulator on `--demo-port` (default 1502) alongside the Agent — this is what QA fixtures use for a one-process "agent + device" setup |
| `--demo-template ID` | emulate any device template id generically on `--demo-port` |
| `--topserver URL` | TOP Server Configuration API base, proxied CORS-free at `/proxy/config/*` |
| `--iot URL` | IoT Gateway REST base, proxied at `/proxy/iot/*` |
| `--remote URL` | central registry DB base URL for pull/push/verify; without it, verify/propose calls are queued locally under `agent/pending_commits/` |
| `--insecure-tls` | disable TLS certificate verification for `--topserver`/`--iot`/`--remote` (lab self-signed certs only — TLS verification is on by default since SEC-4) |
| `--probe HOST[:PORT]` | one-shot CLI check: read one Modbus register (`--addr`, `--unit`) and exit, no server started |

Example — agent + demo device in one process, exactly as `qa5_app.py`/`qa6_field.py` start it:

```
python3 agent/witnessone_agent.py --headless --demo-device --port 5710
```

### 2.3 TOP Server mode

Point WitnessONE's LIVE → TOP Server panel at a real TOP Server Configuration
API (+ optional IoT Gateway). Either:

- browser-direct, if TOP Server's own CORS config allows the WitnessONE
  origin, or
- through the Agent's CORS-free proxy at `/proxy/config/*` and `/proxy/iot/*`
  (start the Agent with `--topserver <url>` and/or `--iot <url>`).

For local testing without a real TOP Server, use the mock (section 2.4).

### 2.4 Fixtures — no hardware needed

**`qa/modbus_device_sim.py`** — a real Modbus TCP server (raw sockets, FC02/
FC03/FC04/FC06) emulating a VERTIV XDU1350B against the SPL 1.0 register map:

```
python3 qa/modbus_device_sim.py --port 1502
```

Then discover/connect WitnessONE (via the Agent) at `127.0.0.1:1502`. This is
what `qa4_agent.py`, `qa6_field.py`, and `qa8_livedirect.py` drive against for
real end-to-end Modbus (FC06 writes actually land on this process, not a
simulation).

**`dist/witnessone_mock_topserver.py`** — a mock TOP Server Configuration API
+ IoT Gateway REST surface (Basic auth `Administrator`/`witness`, PROJECT_ID
header, 201/207 semantics, a seeded `CH_PLANT/AHU_07` project, and a live
XDU1350B physics simulation for `iotgateway/read`):

```
python3 dist/witnessone_mock_topserver.py --port 57418
```

Then in WitnessONE: LIVE → TOP Server, API URL `http://127.0.0.1:57418`,
user `Administrator`, password `witness`, IoT Gateway URL the same
`http://127.0.0.1:57418`. This is what `qa3_live.py` drives.

## 3. QA harness — the setup that actually works here

**Toolchain, verified in this environment:**

- `playwright==1.56.0` (installed via pip; `pip show playwright` confirms
  `Name: playwright / Version: 1.56.0`)
- Chromium is **pre-installed** at `/opt/pw-browsers/chromium-1194`
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is set in the environment; a
  `chromium` symlink there points at
  `chromium-1194/chrome-linux/chrome`). `pw.chromium.executable_path` resolves
  to that binary — confirmed live.
- **Do not run `playwright install`.** There is no outbound package-fetch
  path assumed for it in this setup, the browser is already there, and the
  suites never call it themselves. Just `pip install playwright==1.56.0` (or
  confirm it's already installed) and go.

**Path handling:** every suite under `qa/` derives its own paths from
`__file__` at the top of the file:

```python
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'file://' + os.path.join(ROOT, 'dist', 'WitnessONE.html')
OUT = os.path.join(HERE, '_artifacts') + os.sep
```

This means the suites run correctly **from any checkout path** — there are no
hardcoded absolute paths (this was itself a defect fixed in Round 3, "QA-6";
before that, suites assumed a specific machine's home directory). Run them
from anywhere; you do not need to `cd` into `qa/` first, though `python3
qa/qa1.py` and `cd qa && python3 qa1.py` both work identically.

**Artifacts:** every suite writes its screenshots, downloaded files, and
fixture stderr logs into `qa/_artifacts/` (created with `os.makedirs(...,
exist_ok=True)` if missing). That directory is listed in `qa/.gitignore`
(`_artifacts/`), so QA runs never dirty git status and — specifically —
`qa2.py` no longer overwrites the tracked `qa/Sample_FWT_Certificate.pdf`; it
renders its own copy to `qa/_artifacts/QA2_Sample_FWT_Certificate.pdf`
instead. This was defect QA-6/QA-7 fixed in Round 3; the old suite used to
clobber a tracked binary file on every run.

**Running a suite:**

```
python3 qa/qa1.py
```

Each suite prints `PASS: qaN ok` and exits 0 on success, or prints a `FAIL:
N check(s) failed:` block (each failing check with its detail) and exits 1.
Suites that spin up subprocess fixtures (the Agent, `modbus_device_sim.py`,
the mock TOP Server) poll the fixture's port/HTTP endpoint for readiness
(`wait_for_port`/`wait_for_http`) instead of a fixed sleep, capture the
fixture's stderr to a log file in `qa/_artifacts/`, and call `assert_alive()`
at checkpoints through the run — if a fixture process dies mid-suite, the
suite prints the fixture's stderr tail and exits immediately rather than
limping on and producing a confusing downstream failure.

Verified live in this environment:

```
$ python3 qa/qa9_models.py
VERTIV ok
DELTA ok
ABB ok
DX UNIT ok
SCHNEIDER ok
PAGEERRORS: none

$ python3 qa/qa1.py
BENCH OPENED FROM MENU: True
BENCH CLOSED FROM MENU (re-opens menu, not stuck under drawer): True
PASS: qa1 ok

$ python3 qa/qa10_immutability.py
...
PASS: qa10 immutability ok — approved revisions cannot be overwritten via /pointslists or /propose
```

**Running everything:** there is no single `run_all` script in `qa/` as of
this commit. Run each suite in turn; several bind fixed ports (`qa4`/`qa6`/
`qa8` all use Agent port 5710 and device-sim port 1502; `qa3` uses mock port
57418; `qa10` deliberately uses port 5711 so it can run alongside the others
without a collision — see its module docstring). Don't run two suites that
both bind 5710 at the same time.

```
for f in qa/qa1.py qa/qa2.py qa/qa3_live.py qa/qa4_agent.py qa/qa5_app.py \
         qa/qa6_field.py qa/qa7_frontpage.py qa/qa8_livedirect.py \
         qa/qa9_models.py qa/qa10_immutability.py; do
  echo "=== $f ==="; python3 "$f" || echo "*** $f FAILED ***"
done
```

## 4. What each QA suite covers

| Suite | Fixtures started | What it proves |
|---|---|---|
| `qa1.py` | none (opens `dist/WitnessONE.html` via `file://`) | SIM-mode boot, discovery UI, connect → handshake → assembling → dashboard, X-ray toggle, Test Bench drawer opens from the menu and closes back to the menu without getting stuck under it (regression check for the old QA-2 defect), fault injection, point-detail pane. Screenshots `01_boot.png`…`08_pointdetail.png`. |
| `qa2.py` | none (`file://`) | Full SIM-mode witness-test run at 8x speed, waits for the report button to enable, scrolls the certificate report, downloads the HTML/CSV/JSON exports via Playwright's download API, then opens the downloaded HTML certificate in a second page and renders it to PDF — written only to `qa/_artifacts/`, never touching the tracked `qa/Sample_FWT_Certificate.pdf`. |
| `qa3_live.py` | `dist/witnessone_mock_topserver.py` on port 57418 | TOP Server Config API + IoT Gateway path: API connectivity test, project/tag explorer shows the seeded `CH_PLANT`/`AHU_07` tree, connect LIVE via TOP Server, provisioning creates tags on the mock, a bench setpoint write lands on the mock (verified via a direct `iotgateway/read` call, not just the UI), and the Doctor modal appears (with a path back to SIM) when the API URL is unreachable. |
| `qa4_agent.py` | `qa/modbus_device_sim.py` (port 1502) + `agent/witnessone_agent.py --headless` (port 5710) | Full Agent + real-Modbus path: device-library verify-today check, **real** discovery against the live Modbus emulator with a template match assertion, LIVE Direct-Modbus connect (handshake shows the `--direct-modbus` command and reaches "FULL LIVE telemetry"), an **armed** FC06 write that is confirmed by reading the register back from the Agent (not just from the UI), a full witness-test run at 16x, and a check that the resulting certificate states "Direct Modbus via WitnessONE Agent" as its live data source. |
| `qa5_app.py` | `agent/witnessone_agent.py --headless --demo-device` (one process, port 5710) | Agent-served UI mode (`APP+'/'`, not `file://`) with the built-in demo device: discovery match, LIVE Direct connect, then the **field-add-a-register workflow** — adding an unlisted register (30021) forks a field-draft revision, and the suite asserts the *approved* active template's point count is unchanged, a commit is queued in `agent/pending_commits/`, the draft revision file on disk (`pointslists/vertiv-xdu1350b-cdu/spl-1.0-fld-<date>.json`) has `status: field-draft`, `basedOn: spl-1.0`, and unique point ids/addresses, and that the approved `spl-1.0.json` point count is untouched — this is the day-to-day, non-adversarial exercise of the DATA-2 immutability guarantee that `qa10` stress-tests adversarially. |
| `qa6_field.py` | same as `qa5` | Field workflow depth: a raw `/modbus/scan` register sweep finds the new 30021 register both via the API and the discovery UI overlay ("SPL registers responding" / "NOT in the SPL"), the SAFE chip starts read-only and a write attempt while disarmed is proven to leave the device register unchanged, arming writes flips the chip to ARMED, the witnessed W06 (setpoint-change response) test detects a field-triggered setpoint write, walks through confirm → recovery → PASS, and the resulting certificate carries a "Witnessed field tests" section with the W06 row. Also checks a run is archived to `/records/runs`. |
| `qa7_frontpage.py` | none (`file://`) | Static front-page/catalog checks: DX Unit present and the retired "EHOUSE" make absent from the makes list, the LIVE segment's Modbus/TOP Server pane toggle defaults to Modbus, and a per-asset sweep (VERTIV/DELTA/ABB/DX UNIT/SCHNEIDER) in SIM mode asserting the point table (`#ptRows`, not the old, always-empty `#ptbody` selector) actually has rows for every asset class. |
| `qa8_livedirect.py` | `qa/modbus_device_sim.py` (1502) + Agent `--headless` (5710) | Agent-served UI (`AGENT+'/'`) Direct-Modbus-only smoke test: `/agent/status` reachable, Modbus pane is the default LIVE link, handshake reaches "FULL LIVE telemetry" via the `--direct-modbus` command, and the point table has rows once connected. |
| `qa9_models.py` | none (`file://`) | Visual/model smoke test across all 5 asset classes (CDU/UPS/ACB/DX/PQM): connects each in SIM mode, screenshots the dashboard, and X-rays the two classes (ACB, PQM) whose interiors are worth a second screenshot. Asserts zero page errors across all five. Fastest suite — no subprocess fixtures. |
| `qa10_immutability.py` | Agent `--headless` on an **isolated temp-dir copy** of `devices/`+`pointslists/`+the agent script itself (port 5711, distinct from the others so it can run concurrently) | The regression test for DATA-2: `POST /registry/devices/<id>/pointslists` with `status: "approved"` is refused (409) for two different revId shapes, and `POST /registry/devices/<id>/propose` with a legacy v1 template body that shrinks the point count from 26 to 2 is **accepted** (200, queues a draft) but leaves the approved `spl-1.0.json` file byte-identical on disk — proving both write paths into the approved revision are guarded, not just the modern one. Also asserts the repo's real `pointslists/` (outside the temp copy) was never touched. |

## 5. Troubleshooting

**UI shows "AGENT · NOT RUNNING"** (`src/app/10_boot.js`, `updAgentChip()`,
driven by `W1AGENT.present` from `REGISTRY.detectAgent()` in
`src/app/04b_registry.js`):

- The UI polls `GET /agent/status` on `http://127.0.0.1:5710` (or, when the
  page itself is served from `http://127.0.0.1:5710` or `http://localhost`,
  it uses `location.origin` instead) with an 800ms timeout. If nothing
  answers, `AGENT.present` stays `false` and the chip reads "AGENT · NOT
  RUNNING" — start the Agent: `python3 agent/witnessone_agent.py`.
- If the Agent **is** running but the chip still shows NOT RUNNING when the
  page was opened via `file://`, check the Agent's Origin handling. A
  `file://` page sends the literal `Origin: null` header. The Agent's
  `_allowed_origin()` (agent/witnessone_agent.py) must explicitly allow the
  string `"null"` — this was a real regression (fixed in commit `4f26c2d`,
  same day as the Round 2 guard in `ee91d2f` that introduced it): the
  SEC-1/SEC-3 cross-origin guard added in Round 2 (`ee91d2f`) rejected `null`
  origins outright,
  which 403'd every fetch from the `file://` UI to the Agent and silently
  fell back to SIM mode with the chip stuck on NOT RUNNING. If you're
  running an Agent build from before `4f26c2d`, update it.
- The Agent's same-origin guard (`_guard()`) also rejects any request whose
  `Host` header isn't `127.0.0.1`/`localhost`/`::1` (anti-DNS-rebinding), and
  rejects `http(s)` Origins that aren't localhost. If you're proxying the
  Agent behind a different hostname or port-forwarding from another machine,
  that will also read as "not running" from the browser's perspective — the
  Agent must be reached as `127.0.0.1`/`localhost` (or the same origin the UI
  is served from) for these checks to pass.

**Discovery finds nothing / times out.** Confirm the target actually speaks
Modbus TCP on the IP:port you gave (for the fixtures, `127.0.0.1:1502` is
`qa/modbus_device_sim.py`, not a real network device). For real hardware, use
the Agent's one-shot CLI probe first: `python3 agent/witnessone_agent.py
--probe HOST[:PORT] --addr <SPL addr> --unit <id>` — it prints a checklist
(powered? IP reachable? port 502 open? unit id right? firewall?) on failure.

**A QA suite reports `FIXTURE DIED: <name> exited with code N`.** The suite
captured that fixture's stderr to `qa/_artifacts/<suitename>_..._stderr.log`
and prints the tail inline — read it; the usual cause is a port already in
use from a previous run that didn't get cleaned up (kill any leftover
`witnessone_agent.py` / `modbus_device_sim.py` / `witnessone_mock_topserver.py`
processes bound to 5710/1502/57418/5711 before re-running).

**Writes don't land / setpoint slider does nothing.** WitnessONE gates all
Modbus writes behind an explicit SAFE/ARMED toggle (`#btnArmWrites` in the
Test Bench drawer). This is deliberate, not a bug — the SAFE chip starts
read-only on every connect, and `qa6_field.py` specifically asserts a write
attempt while disarmed leaves the device register unchanged. Arm writes
before expecting a write to take effect.

**An approved points-list revision won't accept an edit / a field register
add doesn't show up in the approved template.** This is DATA-2's immutability
guarantee working as intended: approved revisions are immutable on the
laptop by design (`docs/PRODUCT_ONE_PAGER.md`, "Not doing"). A field-observed
register forks a `field-draft` revision file next to the approved one
(`pointslists/<id>/<rev>-fld-<date>.json`, `status: "field-draft"`,
`basedOn: <approved revId>`) instead of editing it in place; `POST
/registry/devices/{id}/pointslists` with `status: "approved"` always returns
409. See `qa5_app.py` / `qa10_immutability.py` for the exact behavior this
locks in.

**`qa2.py` seems to have overwritten my sample certificate.** It shouldn't —
as of Round 3 it writes only into `qa/_artifacts/` (gitignored). If
`qa/Sample_FWT_Certificate.pdf` (the tracked file at repo root of `qa/`) has
changed, that's a different problem; check `git status`/`git diff` on that
path specifically.
