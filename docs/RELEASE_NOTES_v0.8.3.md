# WitnessONE v0.8.3 "Provenance Seal" — Release Notes

Audience: engineers operating, reviewing, or extending WitnessONE.

**Version story (read first).** This branch reached v0.8.3 in two stages:

1. A **hardening pass** on the v0.8.2 baseline (`4029efa`), commits
   `ee91d2f` .. `4f26c2d` — a three-round multi-agent security/correctness
   review that confirmed 37 defects and landed fixes for ~32, plus two
   same-day regression fixes. This stabilized v0.8.2; it is *not* a feature
   release of its own.
2. The **v0.8.3 "Provenance Seal"** feature release (`ba78b37`) — the P0/P1/P2
   work that makes the tool structurally incapable of issuing a passing
   certificate from unverified data. This is what the version number names.

Both are documented below: the Provenance Seal first (the release proper),
then the hardening fixes it was built on. Full defect-by-defect narrative and
root causes: `docs/OPS_POSTMORTEM.md`. Operating instructions: `docs/RUNBOOK.md`.

## Provenance Seal (the v0.8.3 release proper)

Before this release a **simulated** session could still print a `RED TAG ✔
PASS` certificate — labeling was honest but issuance was not gated. v0.8.3
closes that at issuance:

- **P0 — Issuance gate.** A certificate whose point-to-point values were not
  read LIVE renders as a marked **DEMONSTRATION**: diagonal "SIMULATION DEMO —
  NOT A CERTIFICATE" watermark, no RED TAG, `(DEMONSTRATION)` title, verdict
  prefixed `DEMO —`, and a section-2 comms row of "N/A — no live session". Over
  a dead live link, point-to-point is blocked from starting and stale points
  read BAD → FAIL (the twin still shows last values under the LINK LOST banner:
  display honesty vs certification honesty).
- **P1 — Provenance record.** A session id (`W1S-…`) and preflight record are
  minted on preflight pass; each live value carries its read timestamp and
  Modbus function code; the certificate gains a "Read at" column, Session ID /
  Agent record rows, and archives the run before rendering.
- **P2 — Tamper-evidence.** `POST /records/runs` stores a SHA-256 over the
  canonical run payload and returns it; `GET /records/verify/<id>` recomputes
  and reports `match`; the certificate footer prints the digest and record id.

Acceptance: `qa/qa11_provenance.py` covers all four cases (sim gate, live
provenance, staleness, tamper) and passes headless alongside the 10 prior
suites. P3 (FC43 device-identity binding) and P4 (witnessed-event issuance
enforcement) remain deferred by decision.

## Hardening pass (v0.8.2 stabilization this was built on)

No prior version of this branch was released or depended on for a live
commissioning, so nothing here is a "regression" against a shipped product
in the ordinary sense — it's a pre-release audit. It's written as release
notes because the fixes are real, numbered, and worth a changelog on their
own terms.

## Headline: certificate integrity

The single most serious defect in the set (`CERT-1`): the witnessed
certificate **hardcoded `PASS`** as the overall result even when individual
test rows had failed. A certificate is the entire point of WitnessONE — this
meant it could say the opposite of what actually happened during a witness
test. Fixed in Round 2; the report renderer now computes the overall result
from the actual row outcomes.

## Modbus decoding and discovery (Agent)

- **AG-1** — the discovery probe used register-kind names (`'holding'`,
  `'discrete'`) that didn't match the Agent's own internal vocabulary
  (`'hold'`, `'disc'`), so it silently sent FC01 (read coils) against
  holding/discrete registers instead of FC03/FC02. Fixed: probe now uses the
  correct function codes.
- **AG-2** — `fingerprint()` scored a fabricated constant instead of each
  candidate device template's real point map, so device auto-discovery
  always matched the first template in the registry regardless of what was
  actually on the wire. Fixed: each candidate is now scored against its own
  point map.
- **AG-3** — a Modbus "illegal address" exception (an expected response for
  a sparse point map, not a link failure) was treated the same as a socket
  failure, tearing down an otherwise-healthy session and tripping a 5-second
  circuit breaker. Fixed: raised as a distinct `ModbusException` and handled
  per-cluster without killing the connection.
- **AG-4** — scan results are now reported back in each template's own
  5-digit or 6-digit address convention (previously mixed/wrong per template).
- **AG-5** — the generic device emulator no longer collides its holding and
  input register tables (FC03 vs FC04 responses were aliasing the same
  backing store).
- **Same-day follow-up** (`99b7de9`) — the Round-2 FC/table validator
  (`validate_point_fcs`) flagged `writeFC: "N/A"` on read-only points as a
  contradiction (a legitimate not-writable marker, not a declared write FC),
  producing roughly 31 spurious warnings on startup, and `int()` on any
  non-numeric FC marker raised instead of being treated as "not declared."
  Fixed same day: an FC only counts as declared when it parses to an
  integer.

## 32-bit and bit-mapped live decode

- **LIVE-1 / DATA-1** — 32-bit `float32`/`int32` register spans were read as
  a single 16-bit word instead of combining the high and low words, and
  bit-mapped status points were certified using the raw, unmasked word
  instead of the decoded bit. Neither failure mode looks obviously wrong on
  a report — a half-read float or an unmasked bitfield still renders as a
  plausible number. Fixed in Round 2 for the Agent's Direct-Modbus path
  (`src/app/05b_live.js`); Round 3 extended the same span32+bitmask decode to
  the TOP Server / IoT Gateway live-read path, which had been left on the
  old single-word decode.
- **LIVE-2** — the certificate's live-vs-simulated data-source statement is
  now honest about which path actually produced the value.

## Certificate correctness (beyond CERT-1)

- **CERT-2** — CDU-specific punch-list items were being injected into every
  asset class's certificate (a UPS or breaker's report used to carry CDU
  checklist rows). Fixed: punch-list items are now asset-class-specific.
- **CERT-3** (Round 3) — the certificate serial number is now derived from
  the actual run rather than fabricated; no PASS rows are synthesized that
  didn't happen.
- **CERT-4** — the certificate number, date, and duration are now derived
  from the actual witness-test run instead of from report-generation time,
  so re-opening a saved certificate later doesn't change what it claims
  about when the test happened.

## Approved-revision immutability (`DATA-2`)

Approved SPL (points-list) revisions are documented as immutable on the
laptop — a field change is supposed to fork a `field-draft` revision file,
never edit the approved one in place. Before this fix, `POST
/registry/devices/{id}/propose` could still overwrite an approved revision
via the legacy v1 `{"template": ...}` request body, because the immutability
guard had been applied to the modern `rev`-shaped write path but not
consistently to the older, backward-compatible one. Fixed in Round 2:
`save_template()` now routes through the same `save_revision()` guard.

Round 3 added `qa/qa10_immutability.py`, a standing regression test that
starts the Agent against an **isolated copy** of the registry and proves
both write paths refuse to touch an approved revision: a `status:
"approved"` POST to `/pointslists` returns 409 under two different revId
shapes, and a `/propose` call carrying a legacy template body that shrinks
an approved revision from 26 points to 2 is accepted (200, queues a draft)
but leaves the approved file byte-identical on disk. Verified passing in
this environment.

## Browser / network security hardening

- **SEC-1 / SEC-3 / SEC-6** — the Agent (a bare `http.server` handler with
  no framework) had no origin or Host-header checks at baseline. Any web
  page open in the same browser on the field laptop could script a request
  to `127.0.0.1:5710` and trigger a Modbus write, an internal network scan,
  or a forged audit-trail entry — using the commissioning engineer's own
  machine as the attack vector. Fixed: `_guard()` now enforces a Host-header
  check (`127.0.0.1`/`localhost`/`::1` only — the anti-DNS-rebinding
  backbone, origin-independent) plus an origin allowlist restricted to
  localhost `http(s)` origins and the served UI's own origin; foreign
  `http(s)` origins are rejected outright, and CORS preflight for them fails
  closed.
- **Same-day regression** (`4f26c2d`) — the SEC-1/SEC-3 guard as first
  shipped in Round 2 (`ee91d2f`) also rejected the literal `Origin: null` header that
  browsers send for a page opened via `file://`. That broke WitnessONE's
  primary documented deployment mode ("open `dist/WitnessONE.html`
  directly"): every fetch from the `file://` UI to the local Agent got
  403'd, so the UI reported "AGENT · NOT RUNNING" and silently fell back to
  simulation. Fixed the same day: the guard now explicitly allows the `null`
  origin (so `Access-Control-Allow-Origin: null` can be reflected and the
  `file://` page can read responses) while keeping the Host-header check and
  the foreign-origin rejection intact — an `evil.com` drive-by against the
  localhost API still fails. This does admit other null-origin contexts
  (sandboxed iframes, `data:` URLs) as a documented, bounded trade-off.
  Verified against `qa4` (file:// + Agent, direct-Modbus live telemetry,
  armed FC06 write, live certificate) and `qa8` (agent-served `http://`);
  `qa10` immutability unaffected.
- **SEC-4** — TLS certificate verification is now on by default for the
  Agent's TOP Server/IoT/remote-registry HTTPS traffic (previously
  disabled). An explicit `--insecure-tls` flag remains for known
  self-signed lab servers.
- **SEC-2** — a stored XSS in the report and points-table UI: registry-
  sourced strings (vendor comments, point names — data that ultimately comes
  from a vendor Excel workbook via the parser pipeline) were rendered
  unescaped, so a crafted string in a points-list could execute script in
  the tester's browser. Fixed: all registry-sourced strings are HTML-escaped
  on render (`src/app/07_ui.js`, `src/app/09_report.js`).

## Data pipeline

- **DATA-3** — the points-list parser (`tools/parse_points.py`) now
  preserves bit index correctly and no longer mistypes a binary point as
  `16int` when its Register Type cell is blank.
- **DATA-5** (Round 3, `build.py`) — build-time assertion that every point's
  declared `readFC`/`writeFC` agrees with the Modbus table implied by its
  address, and that any field-derived revision (`basedOn` set) is never
  marked `approved`; violations coerce the revision to `field-draft` and
  print a `WARN` rather than shipping bad data silently.
- **DATA-6** (Round 3, `src/app/08_test.js`) — the FWT test runner now
  defines one documented engineering-unit range semantic and treats
  inverted or full-datatype ranges as "not asserted" rather than silently
  passing or silently failing them.
- **DATA-7** — the Schneider PM8000 curated point-set drop is now explicit
  and logged, not silent; `build.py`'s forward-drift guard (an `assert` on
  `registry.pointCount` vs. the approved revision's actual point count)
  catches a curated set silently gaining or losing points on regeneration.
- **DATA-8** (partial) — `CLASS_MARK` validation added and CDU register
  provenance documented; 14 legacy DCOS marker strings on address-less CDU
  rows remain and are **not** regenerable without the original vendor
  workbook — tracked as an accepted residual, not fixed.
- **BP-1** — `build.py` now escapes `</script>` when embedding vendor JSON
  into the generated HTML, so a vendor free-text field containing that
  literal string can no longer terminate the embedded `<script>` tag early
  and break the offline app.

## Front-end, UX and accessibility

- **QA-2** — the Test Bench drawer no longer paints over the menu panel,
  which had been dead-ending three QA suites' click sequences.
- **QA-3** — a repeat same-day field register add no longer duplicates
  point ids/addresses in the resulting draft revision.
- **UX-1** — the point-name column no longer truncates visually distinct
  points down to identical-looking labels.
- **UX-2** — the connect handshake modal is now escapable (Esc closes it).
- **UX-3** (Round 3) — telemetry tiles and the points table are now
  keyboard- and screen-reader-operable.
- **UX-7** (Round 3) — signature/engineer fields on the certificate now have
  a visible editable affordance and focus state.
- **UX-8** — print page-break protection added so the certificate doesn't
  split content mid-row when printed.

## QA suite rebuild

Independent of any single functional defect above, the QA suite itself
could not reliably catch regressions as shipped at baseline:

- **QA-6** (Round 3) — all 9 (now 10, with `qa10`) suites hardcoded a
  specific machine's home directory; none were runnable from an arbitrary
  checkout. Every suite now derives its paths from `__file__`, and all
  artifacts (screenshots, downloads, fixture stderr logs) go to a gitignored
  `qa/_artifacts/` directory instead of the repo root — `qa2.py` in
  particular no longer overwrites the tracked `qa/Sample_FWT_Certificate.pdf`
  on every run.
- **QA-7** — `qa7_frontpage.py`'s point-table row check used a dead selector
  (`#ptbody`) that always evaluated to zero rows and therefore always
  "passed" its own assertion by construction. Fixed to the real selector
  (`#ptRows`) with an explicit `rows > 0` assertion.
- **QA-4 / QA-5 / QA-8** — the suites exercising the Agent, TOP Server mock,
  and direct-live paths only asserted that fixture processes hadn't
  crashed, not that the values they produced were correct. Fixture stderr is
  now captured to a log file, readiness is polled instead of waited on with
  a fixed sleep, `assert_alive()` checkpoints catch a mid-run fixture death
  immediately with its stderr tail printed, and the silent best-effort
  checks became real assertions that fail the suite — `qa4` in particular
  now explicitly **arms** writes before asserting an FC06 write landed
  (previously, an unarmed write silently no-opping would not have failed
  the check).
- **QA-1** — new `qa10_immutability.py`: starts the Agent against an
  isolated registry copy and proves approved revisions cannot be
  overwritten via either `/pointslists` (409) or `/propose` (approved file
  byte-identical after the call) — locking in the DATA-2 fix as a standing
  regression test rather than a one-time patch.
- `qa5`'s assertions were corrected to match the immutable revision model:
  the approved active template's point count stays fixed after a field add
  (26 for the CDU), and the new field point lands in the field-draft
  revision (27 points) instead.

Verified in this environment: `python3 build.py` succeeds
(`420571 bytes · 5 device(s) · 5 points-list revision(s)`); `qa1`, `qa9`, and
`qa10` all pass headless against `playwright==1.56.0` and the pre-installed
`chromium-1194` browser (`/opt/pw-browsers`).

## Known residuals (not fixed on this branch)

Named explicitly rather than left implicit — see `docs/OPS_POSTMORTEM.md`
for the full prevention-action list:

- **SEC-1 / SEC-6 per-session token** — a stronger per-session auth token on
  top of the origin/Host guard needs the Agent-served UI (not the `file://`
  path) to hand the token to the page; not yet implemented.
- **DATA-8** — 14 legacy DCOS marker strings on address-less CDU
  points-list rows are non-regenerable without the original vendor
  workbook.
- **Version string inconsistency** — README, `docs/CODEBASE_MAP.md`,
  `docs/PRODUCT_ONE_PAGER.md`, and the Agent's `VERSION` constant
  (`"0.3.0"`) all disagree with each other and with this release's own
  `v0.8.3` label. Not resolved by this release; tracked in
  `docs/OPS_POSTMORTEM.md` prevention action 5.
- **Certificate FAIL regression test** — CERT-1 (hardcoded PASS) was fixed,
  but unlike DATA-2 there is no standing regression suite yet that
  deliberately drives a FAIL row into a witnessed run and asserts the
  rendered certificate reports FAIL. Recommended as the next QA addition.

## Commit reference

| Commit | Summary |
|---|---|
| `4029efa` | Import WitnessONE v0.8.2 baseline (review target) |
| `ee91d2f` | Round 2: fix 27 confirmed defects across Agent, UI, certificate & data pipeline |
| `99b7de9` | Fix `validate_point_fcs` false positives on N/A FC markers (same-day) |
| `ef70723` | Round 3: QA hardening + data/cert/live/a11y completion |
| `4f26c2d` | Fix `file://` zero-install regression from the SEC-1/SEC-3 origin guard (same-day) |
