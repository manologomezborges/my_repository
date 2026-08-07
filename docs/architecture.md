# WitnessONE — Architecture (corrected, post-v0.8.3)

This replaces the earlier single-flow diagram. The key correction: **online and
field are two phases that never overlap** (air-gapped field network, single NIC —
enforced in software), so "online" is a *phase*, not a mid-flow "Online?" branch.
Decisions behind every box: `docs/ARCHITECTURE_DECISIONS.md`.

```mermaid
flowchart TB
  subgraph PREP["1 · PREP — ONLINE (registry only, no asset)"]
    reg["Central Registry<br/>make / model / firmware<br/>+ approved SPL revisions"]
    cache["Local cache<br/>templates + SPL revisions"]
    reg -->|"pull latest"| cache
  end

  subgraph FIELD["2 · FIELD — OFFLINE (asset only, no internet)"]
    asset["Asset in the field"]
    subgraph LAPTOP["Laptop · WitnessONE"]
      agent["Agent<br/>Modbus TCP driver<br/>+ provenance stamp<br/>localhost:5710"]
      ui["Browser UI<br/>3D twin · witnessed test<br/>· certificate view"]
      sim["SIM mode<br/>demo / dev / training<br/>labelled DEMONSTRATION —<br/>never issues a certificate"]
      sess["Session store<br/>per-second time series<br/>(SQLite · zero-install)"]
      rec["Records + SHA-256 digest"]
      agent <-->|"localhost HTTP<br/>(trust boundary)"| ui
      sim -.-> ui
      agent --> sess
      agent --> rec
    end
    asset -->|"Ethernet · Modbus TCP"| agent
    cache -.->|"selected make/model/fw + SPL"| ui
    rec --> cert["Certificate<br/>LIVE = issued<br/>SIM = DEMONSTRATION"]
    ui -->|"new / changed asset"| draft["Field-draft revision<br/>saved locally"]
  end

  subgraph SYNC["3 · SYNC — ONLINE (registry only, no asset)"]
    push["Field-drafts +<br/>new / updated make/model/fw"]
    reg2["Central Registry"]
    push -->|"push"| reg2
  end

  PREP ==>|"disconnect internet"| FIELD
  FIELD ==>|"leave site · reconnect internet"| SYNC
  draft -.->|"carried to next SYNC"| push

  ts["TOP Server + OPC UA — NOT bundled<br/>per-machine paid license · Windows-only ·<br/>provision-then-read-back round-trip.<br/>Revisit only if a site standardises on OPC UA."]
  ts -.->|"rejected for the portable tool"| agent

  classDef phase fill:#0d1117,stroke:#30363d,color:#e6edf3;
  classDef store fill:#132a13,stroke:#2ea043,color:#d3f9d8;
  classDef out fill:#1c1c1c,stroke:#8b8b8b,stroke-dasharray:5 5,color:#9d9d9d;
  class reg,cache,sess,rec,reg2 store;
  class ts out;
```

## How to read it

- **Three phases, never simultaneous.** The heavy `==>` arrows are the only way
  to move between phases, and each one names the network transition
  (disconnect / reconnect). The software enforces that a registry connection and
  a device connection are never open at the same time.
- **The trust boundary is the localhost HTTP hop** between the Browser UI and the
  Agent. Browsers can't open raw sockets, so *all* device I/O is in the Agent;
  the UI is presentation. This is where the security model lives (localhost bind,
  CORS lockdown, `file://` null-origin allowance, DNS-rebinding Host check).
- **Data in vs. record out.** Values flow `asset → Agent → UI`; the product that
  comes *out* is the certificate plus the local session store (trends / replay)
  and the digested record — the boxes the old diagram omitted.
- **SIM is a side input to the UI**, clearly labelled, and can never reach the
  "issued certificate" path — only `rec` (a real live record) feeds an issued
  certificate.
- **TOP Server / OPC UA is drawn as rejected**, not as a live path, per AD-3.

## Open item shown implicitly

The digest today is computed over a UI-assembled payload (see the trust-boundary
note and the P4 open decision in `docs/ARCHITECTURE_DECISIONS.md`). The strong
form is the Agent stamping each value it reads server-side; the diagram already
places the "provenance stamp" in the Agent to reflect that target.
