# Postmortem: Multi-Agent Review of WitnessONE (Rounds 1-3)

Status: closed · Blameless · Owner: Ops
Scope: `agent/witnessone_agent.py`, `src/app/*`, `tools/*`, `build.py`, `qa/*`
Source of record: `git log` on this branch (commits `4029efa` .. `4f26c2d`)

## Summary

WitnessONE prints signed Level-1 FWT certificates for industrial equipment
(CDUs, UPS, breakers, power meters) from live Modbus TCP reads. Before this
review cycle, the codebase had never been independently audited end to end.
A multi-agent deep review (Round 1) read the baseline (`4029efa`, "WitnessONE
v0.8.2 baseline") and confirmed 37 defects spanning Modbus decoding, registry
integrity, browser security, certificate correctness, and a QA suite that, as
shipped, could not fail. Round 2 (`ee91d2f`) fixed 27 of the 37 in five
independently verified file partitions. A same-day follow-up (`99b7de9`)
fixed a false-positive regression Round 2 itself introduced. Round 3
(`ef70723`) closed most of the rest and rebuilt the QA suites so they
actually exercise and can fail on the defects being fixed. A final same-day
hotfix (`4f26c2d`) corrected a regression Round 3's own security fix caused
in the zero-install `file://` deployment path.

No customer-visible incident occurred: this was a pre-release audit of code
that had not yet been depended on for a live commissioning. Treating it as a
postmortem is deliberate — the defects found are exactly the class of thing
that, undetected, would have surfaced as wrong data on a signed certificate
or a compromised field laptop.

## Impact — what a field engineer or a signed certificate could have gotten wrong

These are not hypothetical; each is a defect Round 1 confirmed and Round 2/3
fixed, described in terms of what would have reached the field:

- **Wrong register read entirely.** The Modbus probe used kind names
  (`'holding'`/`'discrete'`) that didn't match the codebase's own vocabulary
  (`'hold'`/`'disc'`), so it silently issued FC01 (read coils) against
  holding/discrete registers (AG-1). A commissioning engineer could point the
  tool at a live CDU and get back data from the wrong function code.
- **Wrong device identified.** `fingerprint()` scored a fabricated constant
  instead of each candidate template's real point map, so device discovery
  always matched the first template in the list regardless of what was
  actually on the wire (AG-2). A UPS could be auto-identified and witnessed
  as a breaker.
- **Healthy sessions torn down mid-test.** A Modbus "illegal address"
  exception (a normal, expected response for a sparse point map) was treated
  as a socket failure, killing the connection and tripping a 5-second breaker
  (AG-3) — a witnessed test could drop mid-script for a reason that had
  nothing to do with the asset.
- **Silently wrong values on the certificate.** 32-bit float/int spans were
  read as a single 16-bit word instead of combining the high and low words,
  and bit-mapped status points were certified with the raw, unmasked word
  instead of the decoded bit (LIVE-1/DATA-1). Half a float or an unmasked
  bitfield does not look obviously wrong on a report — it looks like a
  number.
- **A certificate that says PASS when a check failed.** The witnessed
  certificate hardcoded `PASS` as the overall result even when individual
  rows had failed (CERT-1). This is the single most serious defect in the
  set: it is the exact failure mode a signed FWT certificate exists to
  prevent.
- **CDU-only punch-list items on every asset's certificate** (CERT-2), and a
  **certificate number/date/duration derived from report-generation time
  instead of the actual run** (CERT-4) — both undermine the certificate as
  an audit record independent of when someone happened to open the report.
- **An "approved" SPL revision that wasn't actually immutable.** Before
  DATA-2, `/registry/devices/{id}/propose` could overwrite an approved
  points-list revision in place via the legacy v1 template path. Approved
  revisions are the witness-of-record contract for what "compliant" means
  for a device; a silent overwrite means two people looking at "the approved
  SPL for this UPS" on different days could be looking at different data
  with no record that anything changed.
- **A stored XSS in the report/points UI** (SEC-2): registry-sourced strings
  (vendor comments, point names — data that ultimately comes from a vendor
  workbook) were rendered unescaped. A crafted string in a points-list
  workbook could execute script in the tester's browser.
- **A cross-origin drive-by against the local Agent** (SEC-1/SEC-3/SEC-6):
  without an origin/Host check, any web page the field laptop's browser had
  open could script a request to `127.0.0.1:5710` and trigger a Modbus
  write, an internal network scan, or a forged audit-trail entry, using the
  commissioning engineer's own machine as the vector.
- **TLS verification disabled by default** on the Agent's proxy and remote
  registry sync (SEC-4), which is a silent MITM exposure for the TOP Server
  Config API traffic and for registry templates pulled from the central DB.
- **A QA suite that could not fail.** Independent of any single functional
  defect: hardcoded paths meant the suites weren't runnable outside one
  machine, one suite (`qa7`) checked a selector that always returned zero
  rows and therefore always "passed" its own assertion, several suites only
  asserted the fixture process didn't crash rather than checking the actual
  values it produced, and one suite (`qa2`) overwrote the tracked sample
  certificate PDF on every run. None of the functional defects above would
  necessarily have been caught by running the suite as shipped, because the
  suite wasn't actually checking for them.

## Timeline

All dates below are the commit dates in `git log` (this branch); this is a
compressed history, not a real-time incident timeline.

| When | Event | Commit |
|---|---|---|
| Baseline | WitnessONE v0.8.2 imported as the review target | `4029efa` |
| Round 1 | Multi-agent deep review reads the baseline; **37 defects confirmed** across Agent/Modbus, browser security, live decode, certificate integrity, data pipeline, and QA. (Review itself is not a commit in this branch — its findings are enumerated in the Round 2 commit message.) | — |
| Round 2 | **27 of 37** defects fixed across five independently verified, disjoint file partitions: Agent/Modbus (AG-1..5), security (SEC-1,3,4,6), live decode + certificate (LIVE-1/2, DATA-1, CERT-1/2), report/UI (SEC-2, CERT-4), front-end/boot (QA-2/3, UX-1/2/8), data pipeline (DATA-3, BP-1). Remaining items explicitly tracked as partial for Round 3. | `ee91d2f` |
| Same day | Round 2's new FC/table validator over-fired: `writeFC="N/A"` (a legitimate not-writable marker on read-only points) was flagged as a contradiction on ~31 points, and a non-numeric FC value would raise instead of being ignored. Fixed same day. | `99b7de9` |
| Round 3 | QA suites rebuilt to be portable and to actually assert on values (not just "didn't crash"); new `qa10_immutability.py` locks in the Round-2 approved-revision guarantee against an isolated registry copy; remaining data-pipeline (DATA-5/7/8), live-decode (TOP Server path), certificate (CERT-3), and accessibility (UX-3/7) items closed. `python3 build.py` and all 10 QA suites verified green against a clean mirror. | `ef70723` |
| Same day | Round 3's own SEC-1/SEC-3 origin guard introduced a regression: it rejected the literal `"null"` Origin header that browsers send for a page opened via `file://`, which broke the documented zero-install path ("open `dist/WitnessONE.html` directly") — the UI reported "AGENT · NOT RUNNING" and silently fell back to simulation. Fixed same day by explicitly allowing the `"null"` origin while keeping the Host-header check (the real anti-DNS-rebinding defense) and foreign-origin rejection intact. | `4f26c2d` |

Net: roughly 32 of the 37 confirmed defects are fixed on this branch. The
explicitly tracked residuals are a per-session token hardening step for
SEC-1/SEC-6 that needs the served (not `file://`) UI, and 14 legacy DCOS
marker strings on address-less CDU points-list rows (DATA-8) that are
non-regenerable without the original vendor workbook.

## Root causes, grouped by theme

**Modbus decoding (AG-1..5, LIVE-1, DATA-1).** The Agent's register-kind
vocabulary and the probe's vocabulary had drifted apart (`'holding'` vs
`'hold'`) with nothing to catch the mismatch — a string comparison that
silently falls through to "no match" instead of raising is the recurring
shape of this whole category. The 32-bit/bit-mapped decode gap was the same
class of problem one layer up: the low-level read was correct, but the
"assemble the value the certificate will print" step wasn't finished for
those two data shapes, and nothing exercised them because the QA suite's
device fixture didn't need to.

**Registry immutability (DATA-2).** The device model has two independent
write paths into the same file — a modern `rev`-shaped POST body and a
legacy v1 `template`-shaped POST body accepted for backward compatibility.
The immutability guard was applied to the first path but not consistently to
the second, so an old client (or an old code path) could still take the
"short way" around a guarantee the newer path enforced. This is a systemic
risk whenever a service keeps a legacy input shape alive: every guard added
later has to be re-verified against every accepted shape, not just the one
that motivated it.

**Browser security surface (SEC-1..6).** The Agent is a bare
`BaseHTTPRequestHandler` with no framework in front of it, which means CORS,
origin checks, and TLS verification are all hand-rolled and each had to be
individually remembered. None of them existed at baseline. The Round-3
regression (`4f26c2d`) is itself a case study in why this category is hard:
the fix for the cross-origin drive-by (SEC-1/SEC-3) was correct in isolation
but broke a real, documented deployment mode (`file://`) that the review
hadn't fully modeled — security hardening validated against "attacker
origins" without equally validating against "every legitimate origin the
product ships with" will regress the product.

**Certificate integrity (CERT-1..4).** `PASS` was a default, not a
computed result — the report renderer assumed the happy path and never
checked whether any row had actually failed. This is the highest-severity
class of defect in the whole review because the certificate is the product:
everything else in WitnessONE exists to produce that one document, and this
defect meant it could say the opposite of what happened.

**QA that couldn't fail (QA-2/3, DATA-6, plus the whole Round-3 QA
rewrite).** Three separate failure modes stacked: suites that couldn't run
outside one machine (hardcoded paths), a suite whose assertion selector
never matched anything so it "passed" by construction (`qa7`'s `#ptbody`),
and suites that asserted "the process didn't crash" where they should have
asserted "the value is correct" (`qa4`/`qa5`/`qa8` before Round 3). A test
suite that always passes is worse than no test suite, because it produces
false confidence — several of the functional defects above (the 32-bit
decode gap, the immutability gap) existed in a codebase that reported green.

## What went well

- Round 2 was executed as five **independently verified, disjoint file
  partitions**, which kept a 27-defect fix landable as one reviewable commit
  without cross-partition merge risk.
- Certificate/telemetry correctness was **explicitly prioritized** over
  cosmetic and UX fixes when the two competed for review time, matching the
  actual risk (a wrong certificate matters more than a truncated column
  label).
- The immutability fix wasn't just patched — Round 3 added `qa10_immutability.py`,
  a dedicated regression test that runs the Agent against an **isolated
  copy** of the registry and asserts both write paths refuse to touch an
  approved revision. This converts a one-time fix into a standing guarantee.
- The Round-3 security regression (`4f26c2d`) was caught and fixed **the
  same day**, and the fix kept the real defenses (Host-header check,
  foreign-origin rejection) intact rather than loosening the guard broadly —
  it narrowed the exception to exactly the case that needed it.
- The FC-validator false positive (`99b7de9`) was found and fixed the same
  day it shipped, before it had a chance to train engineers to ignore
  warnings from that validator.
- Partial/residual items were **named explicitly** in commit messages
  (SEC-1/SEC-6 per-session token, DATA-8 legacy markers) rather than left
  implicit, so they remain trackable instead of silently forgotten.

## Prevention actions

1. **Make the QA suites part of the definition of done, not a follow-up.**
   Round 1 found defects a green QA suite had missed; require the suite that
   exercises a code path to be updated in the same commit as any change to
   that path, and treat a suite whose assertions can't fail (dead selectors,
   "process is alive" checks standing in for value checks) as a bug on the
   same severity level as the code it's supposed to cover.
2. **Add a build-time or CI check that both registry write paths
   (`rev`-shaped and legacy `template`-shaped) go through the same
   immutability guard**, so a future new input shape can't reopen DATA-2 the
   way the legacy path did. `qa10_immutability.py` covers today's two paths
   from the outside; a code-level assertion (e.g. both handlers call
   `save_revision()` and nothing else writes to `pointslists/`) would catch
   it before a suite has to.
3. **Treat every security guard as a compatibility surface.** Before landing
   an origin/CORS/TLS check, enumerate every documented deployment mode
   (`file://` zero-install, Agent-served `http://`, TOP Server proxy) and
   run the full QA matrix against each — not just the attacker case the fix
   targets. This is what would have caught the SEC-1/SEC-3 `null`-origin
   regression before it shipped instead of the same day after.
4. **Close the two named residual items** on a tracked schedule rather than
   leaving them open-ended: the SEC-1/SEC-6 per-session token (needs the
   served UI, not `file://`) and the DATA-8 legacy DCOS markers (needs the
   original vendor workbook to regenerate cleanly, or an explicit accepted-risk
   note if the workbook is unavailable).
5. **Reconcile the version string.** `README.md` currently describes the
   repo as "the v0.3.0 architecture," `docs/CODEBASE_MAP.md` and
   `docs/PRODUCT_ONE_PAGER.md` say v0.7.0/v0.7.1, and the baseline import
   commit message says v0.8.2. None of these agree, which makes "what
   shipped when" harder to reconstruct during exactly this kind of review.
   Pick one version source (e.g. a `VERSION` file `build.py` reads and
   stamps into the generated HTML and every doc header) before the next
   release.
6. **Certificate correctness gets a standing regression test analogous to
   `qa10_immutability.py`**: a suite that deliberately drives a FAIL row
   into a witnessed run and asserts the rendered certificate says FAIL, so
   CERT-1 cannot silently regress the way DATA-2 could have without
   `qa10_immutability.py`.
