# WitnessONE — Product One-Pager (v0.7.1)

*Stress-tested via idea-refine · design-audited via impeccable + UI/UX priority rules · MG*

## Problem statement

Factory witness tests today are fragmented per vendor: every make/model needs its own
software, cables, licenses and know-how; results land in ad-hoc spreadsheets; points
lists drift from what firmware actually exposes; and "did we really see the failure
and the recovery?" lives in people's memories, not records.

## Recommended direction (what we are building — validated)

One field tool on the Cx laptop: plug into ANY FWT asset over Modbus TCP, pick
make/model/firmware **and the SPL revision** (v4.17 … SPL 1.0), watch it as a live
digital twin, run the witnessed script (the failure comes FROM the unit; the tool
timestamps trigger and recovery), and walk out with a signed Level-1 certificate and
an archived record. Read-only by default; writes are explicitly armed. TOP Server is
an optional layer, not a dependency.

## Key assumptions (and their status)

1. Assets speak Modbus TCP on a known IP — **holds** for the 5 launch classes.
2. Reading registers gently cannot disturb equipment — **designed for** (single
   session, bounded chunked reads, 40 ms gaps, no writes unless armed).
3. The SPL is the contract, and it changes — **now first-class**: revisions are
   selectable; field drafts fork without touching approved lists; central DB approves.
4. Field laptops are locked down — **handled**: single HTML runs from disk; agent
   ships as .exe or zero-install portable bundle; no cloud required on site.
5. Equinix will stand up the central registry DB — **pending** (API contract shipped;
   agent already queues commits offline).

## MVP scope (shipped)

5 asset classes (CDU, UPS, LV breaker, DX unit, PQM) with real form-factor twins ·
SIM / Direct-Modbus / TOP Server modes · register sweep at a known IP · field-draft
revision workflow · witnessed test state machine · certificate + SQLite records ·
59-check QAQC + revision suite, zero console errors.

## Not doing (deliberately)

- IP-range network scanning (you always know the unit's IP)
- Simulated faults as evidence (bench faults are labeled SIMULATION ONLY, never scored)
- Editing approved SPL revisions on the laptop (immutable; drafts only)
- Phone/tablet layouts (the field unit is a laptop; ≥1280 px is the floor)
- Protocol breadth (BACnet/SNMP/OPC UA client) before the registry DB exists

## Next bets, in order

1. Central registry DB pilot (the API the agent already speaks)
2. Certificate vault + cross-FWT dashboard (SSO)
3. OPC UA client for TOP Server live values
4. More device templates via the parser pipeline (drop workbook → template)
