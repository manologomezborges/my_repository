# WitnessONE — Intellectual-Property and Innovation Assessment

**Status: internal engineering-led draft. This is NOT legal advice.**
Nothing here is a legal opinion, a freedom-to-operate clearance, or a
patentability opinion in the formal sense. It is an evidence-based engineering
read of what the current code actually does, written so that a patent attorney,
IP counsel, or product owner can decide whether any of it is worth a real prior-art
search and a professional opinion. Every technical claim below points at the
source file and, where useful, the line range that supports it. Where a fact is
not in the code, it is marked as an assumption or TODO.

**Two hard limits on this document, stated up front:**

1. **No prior-art search was performed.** I did not search patent databases,
   product literature, or standards bodies. I cannot and do not assert that any
   mechanism here is new to the world. "Appears novel" below means only "not
   obviously identical to the conventional building block I can name from
   general engineering knowledge." That is a weak signal, not a conclusion.
2. **Nothing here is asserted to be patentable.** Novelty and non-obviousness
   are legal determinations that require the search in (1) plus counsel's
   judgment. My "patentability view" is a measured guess at where the hurdles
   are, intended to help triage, not to conclude.

Repository reviewed: WitnessONE v0.3.0 (agent `VERSION = "0.3.0"`), commit
history through the Round-3 QA hardening. Author tag throughout the code: "MG".

---

## 0 · One correction before we start

The project is described elsewhere as printing "signed" FWT certificates. For an
IP assessment it matters to be precise: the certificate is **not
cryptographically signed**. The signature and approval blocks are
`contenteditable` HTML fields that a witness types into, followed by a browser
`window.print()` (`src/app/09_report.js`, `paperHTML()` and `REPORT.init()`
around lines 89, 121-128, 172). There is no digital signature, no hash chain, no
key material, and no tamper-evidence on the produced document. This is worth
stating because "cryptographically signed commissioning certificate" would be a
different and stronger IP story than the one the code actually supports. The
integrity work that *does* exist is about **not fabricating PASS/quality data on
the certificate** (see §5), which is a correctness property, not a signing
property.

---

## 1 · How to read the "novelty" and "patentability" columns

For each mechanism I give:

- **What it is** — a precise description with file references.
- **Conventional parts** — the known building blocks it is assembled from.
- **What looks distinctive** — the specific combination or twist that is not
  obviously the same as those building blocks.
- **Patentability view (not advice)** — where the novelty/non-obviousness
  hurdle likely sits.
- **Protection options** — defensive publication vs. trade secret vs. patent,
  weighed against WitnessONE's distribution model.

A recurring theme, so I will say it once here: **WitnessONE ships its source to
the customer.** The field edition is a single HTML file whose entire logic is
readable in the browser (`dist/WitnessONE.html`), and the Agent is a plain
Python file (`agent/witnessone_agent.py`), distributed either as source or as a
PyInstaller `.exe` that can be decompiled (`packaging/build_windows_exe.bat`).
That fact severely limits trade-secret protection for anything on the client or
Agent side, and it pushes most of these mechanisms toward either patenting or
defensive publication rather than secrecy.

---

## 2 · Mechanism A — Versioned, immutable SPL-revision registry with field-draft forking and central publish

### What it is

WitnessONE treats the equipment points list (the "SPL", Standard Points List)
as a first-class, versioned artifact, separate from the device identity. The
on-disk layout (agent header comment, `agent/witnessone_agent.py` lines 46-50,
and the store functions at 51-183):

- `devices/<id>.json` — one file per make/model: identity, layout, firmware
  list, and a `defaultPointsList` pointer (`witnessone.device/2` schema).
- `pointslists/<id>/<revId>.json` — **one file per SPL revision**
  (`witnessone.pointslist/2`), each carrying `status` (`approved` |
  `field-draft`), `basedOn`, `appliesToFw[]`, and the point map.

The distinctive rules enforced across three layers:

1. **Approved revisions are immutable on the laptop.** `save_revision()`
   (agent lines 166-175) reads any existing file at the target path and, if its
   `status == "approved"`, returns `None` without writing. The legacy sync path
   `save_template()` (177-183) is deliberately routed through the same guard.
2. **Field edits fork a draft, never mutate the approved record.** The
   `/propose` handler (agent lines 799-827) takes a field change and, for a v1
   whole-template body, coerces the derived revision to a suffixed
   `...-field-<timestamp>` id with `status = "field-draft"` (lines 812-816) so
   it "cannot overwrite the approved witness-of-record SPL." The
   `/pointslists` handler rejects any incoming `status == "approved"` with HTTP
   409 (lines 794-798): approved revisions are published by the central DB, not
   saved in the field.
3. **The UI forks in the same shape.** `REG.forkDraft()` /
   `REG.snapshotDraft()` / `REG.saveDraft()` (`src/app/04b_registry.js` lines
   93-118) keep a mutable working copy of the point list and only persist it
   into a draft revision; the approved revision the working copy came from is
   never touched.
4. **The build also refuses to ship bad data as approved.** `build.py`
   (`validate_rev_fcs()` and the loop at lines 77-99) coerces any revision that
   is field-derived (`basedOn` set) or whose declared function codes disagree
   with the address-implied Modbus table from `approved` down to `field-draft`,
   with a loud warning.
5. **The certificate carries the provenance.** A draft revision is stamped
   "FIELD DRAFT — pending registry approval" on the certificate
   (`src/app/09_report.js` line 82).

This is verified end-to-end by `qa/qa10_immutability.py`, which runs the Agent
against an isolated registry copy and proves both write paths refuse an approved
revision (409 on `/pointslists`, byte-identical approved file after a `/propose`)
(qa10 lines 1-10, 83-128).

### Conventional parts

- Content-addressed / status-flagged immutable versioning is the everyday model
  of Git, append-only logs, and document-management systems. "Approved records
  are immutable, edits create a new version" is standard in regulated
  document control (QMS, PLM, eQMS).
- A local draft that syncs to a central authority for approval is the standard
  distributed-VCS / pull-request pattern.
- Storing one artifact per file in a directory tree is unremarkable.

### What looks distinctive

The specific combination applied to **field commissioning of industrial
equipment**: a points list that is (a) selectable per test run (a device can be
witnessed against v4.17 or SPL 1.0), (b) immutable once approved *on the
disconnected field laptop specifically*, (c) forkable into a labeled field draft
that (d) is polled live and stamped on the certificate as pending-approval, and
(e) subject to a build-time and runtime consistency check (function-code vs.
address table) that can automatically demote a revision out of "approved". The
"witness-of-record cannot be mutated in the field, but the field can still
propose" property, enforced identically at the Agent, UI, and build layers, is
the part that is not just off-the-shelf VCS.

### Patentability view (not advice)

The hurdle is **non-obviousness**, not novelty of the individual pieces. A skilled
engineer handed "version the points list like Git and don't let field techs edit
approved ones" would arrive at most of this. Any patent theory would have to rest
on a specific, concrete combination tied to the commissioning workflow and the
FC/address consistency demotion, and even then it risks reading as an obvious
application of known versioning to a new field. I would not expect a broad claim
to survive; a narrow claim on the specific multi-layer enforcement plus the
certificate-provenance coupling *might* be worth a search, but I am not
confident. Treat as low-to-moderate priority for a patent inquiry.

### Protection options

- **Defensive publication: recommended.** Publishing the schema and the
  three-layer immutability rule cheaply blocks a competitor from patenting the
  same combination and costs almost nothing given the source already ships.
- **Trade secret: not viable.** The rules are visible in the shipped HTML and
  Python.
- **Patent: only if a search shows the domain-specific combination is clean**,
  and even then expect obviousness pushback.

---

## 3 · Mechanism B — Offline single-file 3D digital-twin + FWT flow with zero runtime dependencies

### What it is

The entire field UI is one self-contained HTML file with no external network
dependencies at runtime. `build.py` (lines 54-126) concatenates the `src/app/*`
modules in a fixed order into `dist/WitnessONE.html`. I verified the built file
references no CDN, no external `<script src>` or `<link>`, and no web fonts. The
only real URLs it points at are `127.0.0.1` (the local Agent / TOP Server) and
the `w3.org` SVG namespace declaration (an XML identifier, not a fetch). The one
other URL-shaped string is an inert placeholder in an input field
(`placeholder="https://host:39320"`), which is display text, not a request. The
single "CDN" occurrence is a comment reading "no WebGL, no CDN."

Inside that file, the 3D digital twin is a **custom canvas renderer, not a
WebGL/Three.js library**. `src/app/06_scene.js` (header lines 1-6) describes a
"painter's-algorithm canvas renderer with holographic shading ... no WebGL, no
CDN," and implements its own vector math, camera, and projection (lines 34-60).
The twin geometry adapts to the active device template's real dimensions and
class (`applyDims()`, lines 13-26: panel meter vs. breaker vs. CDU cabinet
envelopes).

The result is a commissioning tool that runs fully from `file://` with zero
install (README "Field edition only (zero install): open dist/WitnessONE.html").
The Agent even makes a deliberate security trade-off to preserve this
`file://` mode: it reflects the `null` origin so a page opened from disk can
still reach the local Agent (commit "Fix file:// zero-install regression",
`agent/witnessone_agent.py` `_allowed_origin()` lines 526-551).

### Conventional parts

- Single-file HTML apps with inlined JS/CSS are a known packaging technique.
- Software 3D rendering with the painter's algorithm on a 2D canvas is a
  decades-old, textbook technique. Writing your own instead of using WebGL is a
  choice, not an invention.
- Digital twins of equipment are widespread.
- Concatenating source modules at build time is ordinary bundling.

### What looks distinctive

The *combination and its motivation*: a fully offline, zero-dependency,
single-file commissioning app that carries an interactive 3D twin **without any
GPU/WebGL requirement**, sized to survive on a locked-down factory laptop with
no internet and possibly no GPU acceleration, and that adapts one twin engine to
multiple asset classes from template metadata. The engineering value is real and
specific (works on hardware and networks where a WebGL/CDN app would not). Note
this is a rendering/architecture choice, largely **aesthetic and
functional-packaging** in nature.

### Patentability view (not advice)

This is the **weakest patent candidate** of the four. Software rendering
techniques and single-file packaging are old and well-documented, so both
novelty and non-obviousness hurdles are high, and much of what is valuable here
(the offline, no-GPU packaging) reads as an engineering trade-off rather than an
inventive step. I would not pursue a patent theory here without a strong,
specific angle from counsel. The visual design of the twin, separately, may
attract **copyright** (the code as a literary work) and possibly design-related
protection for a distinctive UI, but that is outside this mechanism-level view.

### Protection options

- **Copyright: automatic** on the source; ensure headers/license are correct
  (author "MG" appears throughout; confirm ownership/assignment — see §7 TODO).
- **Defensive publication: optional**, low value, since the technique is old.
- **Trade secret: not viable** (source ships in the browser).
- **Patent: not recommended** absent a specific novel angle.

---

## 4 · Mechanism C — Agent direct-Modbus live path that avoids an IoT-gateway license

### What it is

WitnessONE can drive live values by talking Modbus TCP directly, over raw
sockets, from the local Agent, instead of routing through a licensed IoT gateway
product. The pieces:

- A hand-rolled Modbus TCP client (`agent/witnessone_agent.py` class `Modbus`,
  lines 224-267): MBAP header framing, FC01/02/03/04 reads, FC06 write, exact
  byte packing.
- A **field-safe connection policy** built around it: one persistent TCP
  session per device, serialized requests, bounded block sizes, and a circuit
  breaker that marks a device "down" for 5 s after a connect failure so callers
  fail fast instead of piling up timeouts (`_conn` / `with_device`, lines
  333-373). Critically, it distinguishes a **protocol-level Modbus exception on
  a healthy socket** (custom `ModbusException`, lines 218-222) from a transport
  failure, so an "illegal data address" does not tear down a working session or
  trip the breaker (handled at 360-365 and in the block reader 402-414).
- Clustered block reads that expand 32-bit spans and split sparse maps into gap-
  bounded blocks (`template_offsets`, `cluster`, `read_template_block`, lines
  282-415), returning a raw `{addr: value}` map.
- The **same decode path for both live sources.** The Agent returns raw 16-bit
  words/bits, and the UI's `composePoint()` (`src/app/05b_live.js` lines
  196-226) combines 32-bit spans (float32 / signed / unsigned, honoring word
  order), extracts bit-mapped points via mask, and applies sign. The TOP
  Server / IoT-gateway path is deliberately folded into the *same*
  `composePoint()` (lines 165-173 and the header comment 186-195) so a
  bit-mapped or 32-bit point collapses to one composed value regardless of
  source. This was a specific Round-3 fix ("LIVE residual ... routes the TOP
  Server / IoT read path through the same span32+bitmask decode as the Agent
  path").

The product framing (README): "Direct-Modbus live values (no IoT Gateway
license needed)". So the *business* novelty is removing a licensed middleware
dependency from the live-commissioning loop.

### Conventional parts

- Raw-socket Modbus TCP clients are extremely common; the protocol is open and
  many open-source libraries implement exactly this (pymodbus, etc.). Nothing in
  the framing/packing is new.
- Persistent connections, request serialization, circuit breakers, and
  block/coalesced reads are standard industrial-comms engineering.
- Decoding 32-bit spans and bit fields from Modbus words is routine.
- Talking to equipment directly instead of via a gateway is, by itself, just
  "use the open protocol."

### What looks distinctive

Two things, both modest:

1. The **unified decode contract** where a *raw-Modbus source and a
   gateway/config-API source flow through one composition function**, with an
   explicit rule that a gateway-flagged bad tag becomes `null` and is reported
   BAD rather than certified (05b_live.js 165-173). This "one decode, provenance
   preserved, never certify an untrusted read" property is a correctness design,
   and its coupling to certificate integrity (§5) is the interesting part.
2. The **healthy-socket-vs-transport distinction** feeding a per-cluster
   narrowing read that keeps the session alive (agent 360-414). It is good
   engineering; whether it is *inventive* is doubtful.

The core "avoid the IoT-gateway license by speaking Modbus directly" is a
commercial/architectural decision using an open protocol, which is generally not
by itself patentable subject matter.

### Patentability view (not advice)

Low. The Modbus client and direct-connection approach are conventional and
widely implemented; novelty and non-obviousness hurdles are high. If anything
here is worth a look, it is the *narrow* combination of the unified
multi-source decode with the certificate-integrity rule (only certify reads
whose provenance and quality are trustworthy), and that is really Mechanism E
(§5) wearing a different hat. Do not expect a defensible patent on "direct
Modbus."

### Protection options

- **Trade secret: not viable** (Agent source ships / is decompilable).
- **Defensive publication: reasonable** for the unified-decode + quality rule,
  mainly to keep the space open.
- **Patent: not recommended** for the direct-Modbus path itself.

---

## 5 · Mechanism D — Register fingerprinting / discovery and gentle scan

### What it is

Given a subnet, the Agent probes hosts and tries to identify the device by
**scoring each candidate template against its own point map over a live Modbus
session**, rather than matching a fixed signature.

- `fingerprint()` (agent lines 490-519) opens a real Modbus session and, for
  every template in the library, calls `_template_match()`.
- `_template_match()` (lines 455-488) reads a sample of *that template's own*
  points (respecting kind, 32-bit span, and gain) and scores each on whether it
  responds and lands inside the point's declared range (full credit for
  in-range, partial for "responded but unconfirmable", zero for "address not
  implemented / illegal"). It returns `(score, points_tried)`.
- An identity is only claimed when the best match is **template-specific and
  strong**: `best[1] >= 4` points tried and `best[0] >= 0.6` score (line 511),
  with confidence capped at 99% and never fabricated. The commit history records
  that this replaced an earlier bug where a fabricated constant made the first
  template always win (AG-2 in the Round-2 commit).
- Discovery is concurrent across up to 254 hosts with a fast TCP pre-check
  (`/modbus/discover`, lines 670-683).
- A separate `scan_registers()` (lines 417-453) does a **gentle** register
  sweep at a known device: small chunked reads with inter-request delays, and on
  an "illegal address" exception it narrows to single-register probes instead of
  hammering. Template-derived scan ranges are reported back in the template's
  *own* 5- or 6-digit address form (scan handler lines 684-712, `addr_split`
  lines 269-280).

### Conventional parts

- Device fingerprinting by reading registers and comparing to a signature is a
  known idea in industrial asset discovery and OT security scanning.
- Concurrent TCP sweep of a subnet is ordinary.
- Rate-limited scanning and "back off / narrow on error" are standard careful-
  scanner behavior.
- Range/plausibility checks on readings are routine.

### What looks distinctive

The scoring is **self-referential to each candidate template**: instead of a
hand-authored fingerprint per device, the match uses the template's *existing*
point map (addresses, kinds, spans, gains, ranges) as the discriminator, with an
explicit evidence threshold (enough of the template's own points must respond
in-range) before an identity is asserted. That "the points list *is* the
fingerprint, and we refuse to guess without enough in-range evidence" property is
the most genuinely interesting of the four from a technical standpoint, and it is
tightly integrated with the same template/registry model as Mechanism A. The
gentle-scan behavior that reports in the template's native address dialect is a
nice touch but likely conventional.

### Patentability view (not advice)

This is the **best of the four candidates to actually investigate**, and I still
would not overstate it. The novelty question is whether "use the equipment's
own configured points list as the discovery fingerprint, gated by an in-range
evidence threshold, to auto-select the correct commissioning template" is
distinct from known register-fingerprinting. That genuinely needs a prior-art
search; OT-security and asset-discovery literature is exactly where a killer
reference would live, and I have not looked. The non-obviousness hurdle is real
because "read the registers you expect and check they respond in range" is an
intuitive approach. My honest read: worth a scoped prior-art search before any
opinion, moderate expected value, not a slam dunk.

### Protection options

- **Patent: the one candidate worth a real prior-art search** and a counsel
  conversation, precisely because the client-side visibility problem is smaller
  here (the scoring lives in the Agent, and the *value* is in the method, which
  a patent could protect even though the code is readable).
- **Defensive publication: the fallback** if the search turns up close art or
  if the business does not want to fund prosecution. Publishing still blocks
  others from claiming it.
- **Trade secret: not viable** (Agent source / decompilable), which is another
  reason patent-or-publish is the real choice.

---

## 6 · Mechanism E — Certificate/telemetry data-integrity discipline (cross-cutting)

Worth naming on its own because several Round-2/Round-3 fixes converge on one
principle: **the certificate must never assert a PASS, a GOOD quality, or a
scaled value that the tool did not actually observe.** Concretely:

- In a LIVE session the UI refuses to fall back to the simulator; a register
  with no fresh read is reported BAD (stale/no-data), not silently simulated
  (`src/app/05b_live.js` `LIVE.install()` lines 227-257, comments at 240-243).
- Link loss drops the last values so reads go BAD rather than being served as
  live GOOD (05b_live.js 175-183).
- The certificate derives its comms/quality check and PASS/FAIL from the actual
  reads, not a hardcoded PASS, and does not print the demo serial constant as a
  real serial (`src/app/09_report.js` lines 50-53, 26-28, 80; CERT-1/CERT-3 in
  the commit history).
- Declared engineering ranges that are inverted or span the whole raw datatype
  are treated as "not asserted" instead of vacuously passing or spuriously
  failing (`src/app/08_test.js` lines 11-41).
- Registry-sourced strings are HTML-escaped on render to close a stored-XSS
  vector (SEC-2 in the commit history; `esc()` in 09_report.js line 6).

**Assessment:** This is correctness and safety engineering, not a patentable
mechanism. Its IP value is mostly as *evidence of diligence* (useful if the
certificates are ever relied on contractually) and as a candidate for
**defensive publication** in combination with Mechanisms A and D, since the
"never certify a reading you did not trust, and record its provenance" rule is
the connective tissue of the product. No patent theory recommended on its own.

---

## 7 · Summary triage

| Mechanism | Genuinely distinctive? | Patent worth a search? | Best protection |
|---|---|---|---|
| A · Immutable SPL-revision registry + field-draft fork + central publish | Combination, yes; parts, no | Low-moderate, narrow only | Defensive publication |
| B · Offline single-file, no-GPU 3D twin, zero deps | Packaging/rendering choice | No | Copyright; maybe publish |
| C · Direct-Modbus live path (no IoT-gateway license) | Mostly commercial/architectural | No | Publish the unified-decode rule |
| D · Register fingerprinting via the template's own point map | Yes, most interesting | **Yes — scoped search first** | Patent-or-publish |
| E · Certificate/telemetry integrity discipline | Correctness, not a mechanism | No | Publish (with A/D); diligence evidence |

### Cross-cutting recommendations

1. **Do a scoped prior-art search on Mechanism D first.** It is the only one
   where a patent conversation is clearly justified, and the search will also
   tell you whether to patent or defensively publish.
2. **Default everything else to defensive publication.** Because the client and
   Agent source ship to customers, trade secret is largely off the table, so
   the cheap, effective move for A, C, and E is to publish enough to keep
   competitors from patenting around WitnessONE.
3. **Do not market the certificate as "signed" without adding real signing.**
   (§0.) If cryptographic signing / tamper-evidence is added later, revisit —
   that could become a stronger, separately assessable IP item.
4. **Confirm ownership/assignment of the "MG" authored code** before any
   filing or publication. *(TODO: ownership and any Equinix/employer assignment
   terms are not determinable from the repository; confirm with counsel.)*
5. **Standards references on the certificate** (ASHRAE, OCP L2L, Vertiv
   document numbers in `09_report.js` line 131) are cited, not implemented or
   claimed; no standards-essential-patent exposure is created by the code as
   written, but confirm the citations are accurate and licensed for display.

---

*Prepared as an internal engineering assessment to support a later legal review.
Not legal advice. No prior-art search was conducted. No mechanism is asserted to
be patentable.*
