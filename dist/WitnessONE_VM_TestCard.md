# WitnessONE v0.8.3 "Provenance Seal" — VM / Field Test Card (5 minutes)

## 0 · Start it
Unzip the repo. Double-click `packaging\run_agent.bat`.
A WitnessONE app window opens (that borderless window IS the design — no browser chrome).
Boot card shows **AGENT v0.3.0** chip in green.

## 1 · Prove a REAL Modbus point in 30 seconds (no hardware needed)
Close the app window. Run instead:
```
packaging\run_agent.bat --demo-device
```
This starts a REAL Modbus TCP server (a fake CDU) on 127.0.0.1:1502 + the tool.
In the boot card: IP `127.0.0.1` · Port `1502` · click **⛓ LIVE** →
press **⚡ Test Modbus point** → you should see:
`✔ 30001 = 5 · N ms · REAL MODBUS TCP`
That is a raw Modbus frame on a TCP socket — the driver, proven.

## 2 · Full live session
Click **CONNECT** → handshake shows `--direct-modbus` and mints a
**Session `W1S-…`** line → chip reads **FULL LIVE · DIRECT MODBUS (AGENT)** ·
RX 22/22. Values in the table are being block-read from the emulator once per second.

## 3 · Real equipment
Plug the laptop into the unit's network. `ping <unit-ip>` first.
Enter the unit's IP · port (usually 502) · unit ID → **⚡ Test Modbus point**.
- ✔ value → hit CONNECT; you're witnessing live. Polling is READ-ONLY until armed.
- ✕ error → checklist: unit powered? IP right (ping)? port 502 open on the unit?
  unit ID right (try 1, 2, 255)? Windows Firewall / VM network mode (bridged, not NAT)?

Command-line alternative (no UI):
```
py agent\witnessone_agent.py --probe 192.168.10.51:502 --unit 1 --addr 30001
```

## 4 · Prove the Provenance Seal — the issuance gate (v0.8.3)
The point of v0.8.3: a certificate can only PASS on values actually read live.

**a. Simulated run cannot issue a certificate.** Start plain (`run_agent.bat`, no
`--demo-device`), connect in **SIM**, run the witness test, open **📜 Certificate**.
It must render as a **DEMONSTRATION**: a diagonal *"SIMULATION DEMO — NOT A
CERTIFICATE"* watermark, **no RED TAG**, verdict prefixed **DEMO —**, and the
section-2 comms row reads *"N/A — no live session"*.

**b. Live run issues a real certificate with provenance.** With `--demo-device`
(or real hardware), connect LIVE, run the witness test, open the certificate. It
must show: **no watermark**, the **RED TAG ✔** (on PASS), a **Session ID** and
**Agent record #N** in section 1, a **"Read at"** column with per-point read time
and function code, and an **Integrity: SHA-256 …** line in the footer.

**c. Link-loss is honest.** Mid-session, unplug the unit (or stop `--demo-device`).
Within a few seconds the chip goes **LINK · LOST**, the twin keeps showing the last
values under that banner, but the points read **BAD/STALE** — a point-to-point run
now **FAILs** those points and will not start over a dead link. No simulated value
is ever presented as live.

## 5 · Prove tamper-evidence (30 seconds, command line)
After a live run archived a record (say `#1`), confirm the certificate's digest
against the agent's authoritative record:
```
curl "http://127.0.0.1:5710/records/verify/1"
```
`{"match": true, ...}` → the archived record is intact. Pass the digest printed
on the certificate as `?digest=<hex>` to check a specific downloaded copy
(`"externalMatch": true`). Any change to the stored payload flips `match` to
`false`. (Integrity = hash vs the agent's record; it is not a PKI signature.)

## 6 · One-command automated proof (no clicking)
Everything in sections 4–5 is asserted headless by the acceptance suite:
```
py qa\qa11_provenance.py
```
`PASS: qa11 provenance ok — issuance gate, provenance record, and tamper-evidence
all hold`. The full regression set is `qa\qa1.py` … `qa\qa11_provenance.py`
(Playwright headless; use `playwright==1.56.0` against the pre-installed browser —
never run `playwright install`). See `docs/RUNBOOK.md`.

## Notes for VMs / RDP
Windows disables animations over RDP, and the tool respects that (calmer scene,
auto-orbit off by default). Click **⟳ Auto-orbit** to spin it anyway. On slow VMs
the scene auto-reduces particles to stay smooth — the twin and data stay identical.

*Honest scope: `--demo-device` is a real Modbus TCP emulator, not physical
third-party hardware — it proves the driver and the provenance seal end-to-end.
Section 3 is the physical-asset proof; run it on the VM against the unit (or a
Modbus Slave endpoint) to close the loop.*
