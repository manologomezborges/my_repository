# WitnessONE — Architecture Decisions (post-v0.8.3 design pass)

Decisions taken with MG in the design session after v0.8.3. These supersede the
conflicting bullets in `docs/PRODUCT_ONE_PAGER.md` where noted, and set the
target the next architecture diagram is drawn against.

## AD-1 · Simulation stays, as the demo/dev/training environment (not removed)

We keep the simulation mode, but its role is explicit: **demo, development, and
training** — never a certificate. It inherits the v0.8.x honesty work: a SIM
session renders as a labelled DEMONSTRATION (watermark, no RED TAG, DEMO
verdict) and is structurally incapable of issuing a real certificate. Only a
LIVE session issues. Rationale: every product needs a no-hardware way to show
and learn the tool; killing sim would remove that.

## AD-2 · Online and field are mutually exclusive in time — enforced in software

The laptop is **never** connected to the internet and to the field asset at the
same time (air-gapped field network, single NIC). This is a hard technical fact
and must be **enforced by the software**, not just documented. The tool runs as
an explicit three-state machine:

1. **PREP (online, registry only):** pull the latest make/model/firmware + SPL
   revisions from the central registry, cache locally, then close the online
   connection.
2. **FIELD (offline, device only):** connect to the asset; read live, run the
   witnessed test, capture the session, produce the certificate; edit points
   locally (field-draft) if the asset is new or changed.
3. **SYNC (online, registry only):** push field-drafts / new-or-updated
   make/model/fw back to the central registry.

The tool refuses to hold a registry connection and a device connection
simultaneously. The old single-flow "Online?" branch is wrong — "online" is a
*phase*, not a mid-flow decision.

## AD-3 · Comms: keep the hardened in-tool Modbus TCP driver; TOP Server rejected for the portable tool

Decided after a 2026 library/vendor review (see `## Evidence`).

- **Direct Modbus is the primary path**, using WitnessONE's own zero-dependency
  stdlib Modbus TCP client (`agent/witnessone_agent.py`, `class Modbus`). It now
  handles: partial-read reassembly, MBAP transaction-id/proto/unit matching,
  slave exception responses, and (client-side) word-order-aware 32-bit/float
  decode. Rationale: best license (none), zero dependencies, cleanest
  single-file / PyInstaller / zero-install story — which also protects the
  zero-dependency ethos the IP position rests on.
- **pymodbus 3.14.0 (BSD-3, pinned)** is the sanctioned fallback if we later need
  serial/RTU, async fan-out across many devices, Modbus-over-TLS, or want to stop
  owning protocol code. Cost: pin the version and budget for major-bump
  migrations; add `--collect-submodules pymodbus` when freezing.
- **TOP Server + OPC UA is NOT bundled.** This reverses the tentative "bundle TOP
  Server" idea. Decisive reason: **TOP Server is licensed per-machine and is not
  redistributable** — we cannot ship it in the repo/installer; every site would
  need its own paid license. It is also Windows-only, a heavy installed service
  (breaks zero-install), and the "provision channel/device/tags over the Config
  API, then read back over OPC UA" round-trip is an anti-pattern for a portable
  field tool. If a customer environment standardises on OPC UA and accepts
  per-site licensing, the OPC UA client path (asyncua, LGPLv3 — freeze
  `--onedir`) can be revisited then, not now.

## AD-4 · Session history & trends — local, from second one

The moment a FIELD session opens, record it locally as a per-second time series.
Two uses: (a) the certificate/report renders the **trends**; (b) a past session
can be **reopened and scrubbed** to investigate anomalies (valve opening vs.
temperature drop over time). The store is **SQLite** — which is *not an install*:
it is Python's stdlib (`import sqlite3`), a single file on disk, no server, no
admin. It is the lightest option that supports time-series + reopen, and it is
what makes the trends feature possible. (This retires the "is SQLite a
complication" concern: it is the enabler, not a dependency to add.)

## AD-5 · Field editing of make/model/firmware + SPL — draft locally, push on SYNC

A new or changed asset in the field: check the device against the SPL (the
contract); if there is no template, create a new make/model; if firmware differs
or points changed, add/update those points. Save as a **field-draft revision
locally** (approved revisions stay immutable). Push back to central during the
next SYNC phase. This is the existing immutable-approved + field-draft workflow.

## Open decision (flagged, not yet taken) · provenance trust boundary (P4)

Today the tamper-evidence digest is computed by the Agent over a certificate
payload **assembled and submitted by the browser UI**. It proves the archived
record is unchanged since archive; it does not by itself prove the values were
read live rather than asserted by the UI. Moving the binding server-side — the
Agent stamps each value it reads (value/ts/fc/session) and the certificate is
built from / cross-checked against the Agent's own record — is deferred **P4**
and would materially strengthen the "bound to protocol-level evidence" position.

## Evidence

Modbus library / TOP Server review (2026): pymodbus 3.14.0 (BSD-3, actively
maintained, notorious API churn — pin it), pyModbusTCP 0.3.0 (MIT, zero-dep,
TCP-only, slow cadence), modbus-tk (LGPL + pyserial — copyleft friction),
uModbus (abandoned), minimalmodbus (serial-only, no TCP). TOP Server licensing:
per-machine, non-redistributable per the vendor EULA/support pages (confirm OEM
terms in writing before ever relying on redistribution). Best Python OPC UA
client if that path is ever taken: asyncua (LGPLv3, pulls `cryptography`).
