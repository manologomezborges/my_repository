# WitnessONE v0.7.2 — VM / Field Test Card (5 minutes)

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
Click **CONNECT** → handshake shows `--direct-modbus` → chip reads
**FULL LIVE · DIRECT MODBUS (AGENT)** · RX 22/22. Values in the table are being
block-read from the emulator once per second.

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

## Notes for VMs / RDP
Windows disables animations over RDP, and the tool respects that (calmer scene,
auto-orbit off by default). Click **⟳ Auto-orbit** to spin it anyway. On slow VMs
the scene auto-reduces particles to stay smooth — the twin and data stay identical.
