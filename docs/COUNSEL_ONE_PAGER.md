# WitnessONE — Counsel One-Pager (built-status update, v0.8.3)

*Internal engineering summary for the patent team. Not legal advice. No
independent prior-art search has been performed; statements of novelty are the
inventor/engineering view, to be tested by counsel. Full technical detail:
`docs/LEGAL_IP_ASSESSMENT.md`.*

## Why this update

The 2026-08-03 counsel exchange asked us to distinguish what is **built** from
what is **designed**, and identified the single point of novelty as *binding a
commissioning attestation to protocol-level evidence*. Since then the v0.8.3
"Provenance Seal" release has moved several of those items from designed to
built. This page restates the position with current build status and commit
references so the disclosure/claim set can be updated.

## The candidate invention (unchanged)

A field commissioning tool that produces a witness-test certificate whose
point-to-point values are **bound to protocol-level read evidence**, and whose
issuance is **fail-closed**: a certificate can only assert PASS on values that
were actually read live from the asset over the wire. Supporting, claim-relevant
mechanisms:

- **Governed, immutable SPL (points-list) revision identity.** A test is run
  against a specific, versioned, immutable approved revision; field changes fork
  a clearly-labelled *field-draft* revision and never mutate the approved one;
  the central DB reviews and publishes.
- **Fail-closed issuance.** Simulated or link-lost data cannot yield a passing
  certificate.
- **Per-value provenance + tamper-evidence** on the produced record.

Explicitly **disclaimed** as prior art (do not claim): the Modbus driver itself
(1979 protocol), the 3D digital twin, and generic commissioning-checklist
workflow. Nearest art to distinguish remains **BTL-style conformance testing**
(a product model, in a lab) versus this (*this serial, at this factory, against
the customer's governed SPL, with fail-closed issuance*).

## Built vs designed — current status

| Item | 2026-08-03 | Now (v0.8.3) | Evidence |
|---|---|---|---|
| Live raw-Modbus read path (Agent driver) | built | **built** | `agent/witnessone_agent.py` Modbus class; probe proven |
| Immutable approved SPL revision + field-draft fork | built | **built** | `save_revision()` 409 guard; `qa/qa10_immutability.py` |
| Fail-closed issuance gate (sim/link-lost cannot pass) | designed | **BUILT** | `09_report.js` DEMONSTRATION gate; `08_test.js`/`05b_live.js` staleness; `qa/qa11_provenance.py` |
| Per-value provenance record (session id, read time, function code) | designed | **BUILT** | `10_boot.js` session mint; `05b_live.js` fc/ts; certificate "Read at" column |
| Tamper-evidence digest + verify (assessment dependent claim 4) | designed | **BUILT** | `run_digest()` + `GET /records/verify/<id>`; commit `ba78b37` |
| Central registry DB (pull/verify/propose) | API shipped, DB pending | API shipped, **DB pending** | agent queues commits offline in `pending_commits/` |
| Device-identity binding via FC43 (P3) | designed | **designed (deferred)** | roadmap |
| Witnessed-event issuance enforcement (P4) | designed | **designed (deferred)** | see caveat below |

## Points counsel should weigh

1. **Dependent claim 4 (digest/verify) is now practiced.** The record carries a
   SHA-256 over its canonical payload and a verify endpoint recomputes it. This
   is **hash-based integrity, not a PKI digital signature** (no keys, no external
   chain of trust) — so "cryptographically signed certificate" is still not
   accurate language.
2. **A known limitation to disclose honestly.** The digest is currently computed
   by the Agent over a payload assembled and submitted by the browser UI. It
   proves the archived record is unchanged since archive; it does **not** by
   itself prove the values were read live rather than asserted by the UI. Making
   the Agent the sole provenance authority (stamping reads server-side) is the
   intended hardening (this is what deferred **P4** covers) and would materially
   strengthen the "bound to protocol-level evidence" claim. Counsel may want the
   claim language to describe the *server-side binding* target, noting current
   build status.
3. **SPL confidentiality (disclosure §9).** Publishing SPL structure in a filing
   may cost more than it gains; argue the *process* (governed spec identity +
   live per-value provenance + fail-closed issuance), never "it is our own spec."
4. Provisional not confirmed filed; US grace period / foreign novelty caution
   stands. Confirm ownership/assignment of the "MG"-authored code before any
   filing or publication.

*Commit range for this update: `ba78b37` (Provenance Seal) on branch
`claude/multi-agent-workflow-setup-36ggnl`, atop the v0.8.2 hardening pass
`ee91d2f`..`4f26c2d`.*
