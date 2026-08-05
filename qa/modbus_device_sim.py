#!/usr/bin/env python3
"""Real Modbus TCP device emulator of a VERTIV XDU1350B (SPL 1.0 registers).  MG
Answers actual FC02/03/04/06 frames over raw sockets — used to end-to-end test the
WitnessONE Agent, and handy for demos without hardware:
    python3 modbus_device_sim.py [--port 1502]
Then discover/read 127.0.0.1:<port> from WitnessONE (via the Agent)."""
import socket, struct, threading, time, math, random, argparse

T0 = time.time()
SP = {"v": 320}  # raw (gain .1)

def _n(a): return (random.random() * 2 - 1) * a
def state():
    t = time.time() - T0
    sp = SP["v"] / 10
    t2 = sp + 0.18 * math.sin(t / 9) + _n(0.05)
    load = 620 + 14 * math.sin(t / 47)
    secflow = 700 + 8 * math.sin(t / 13) + _n(3)
    t4 = t2 + load * 14.33 / max(secflow, 60)
    t1 = 26.5 + 0.6 * math.sin(t / 120)
    priflow = 465 + 6 * math.sin(t / 17)
    t5 = t1 + load * 14.33 / max(priflow, 60)
    ps1 = 1.18 + _n(0.005); ps2 = ps1 + 1.17 + _n(0.01)
    cv = 46 + 2.2 * math.sin(t / 22)
    inp = {1: 5, 3: 61 + _n(0.5), 4: 60.5 + _n(0.5), 5: 0, 21: t2 * 10 + 14,
           7: cv, 8: cv, 9: cv, 10: cv,
           11: t1 * 10, 15: t2 * 10, 19: t4 * 10, 20: t5 * 10,
           23: ps1 * 100, 26: ps2 * 100, 27: (ps2 - ps1) * 100,
           28: 262 + _n(1), 29: 250 + _n(1), 31: priflow, 32: secflow,
           41: 6.8 + _n(.2), 42: 7.4 + _n(.2), 43: 6.2 + _n(.2)}
    return inp

def handle(conn):
    try:
        while True:
            hdr = b""
            while len(hdr) < 7:
                c = conn.recv(7 - len(hdr))
                if not c: return
                hdr += c
            tid, proto, ln, unit = struct.unpack(">HHHB", hdr)
            body = b""
            while len(body) < ln - 1:
                c = conn.recv(ln - 1 - len(body))
                if not c: return
                body += c
            fc = body[0]
            def reply(pdu):
                conn.sendall(struct.pack(">HHHB", tid, 0, len(pdu) + 1, unit) + pdu)
            if fc in (3, 4):
                start, cnt = struct.unpack(">HH", body[1:5])
                vals = []
                for i in range(cnt):
                    a = start + i + 1  # 1-based offset within table
                    if fc == 4: v = state().get(a, 0)
                    else: v = SP["v"] if a == 1 else 0
                    vals.append(max(0, int(round(v))) & 0xFFFF)
                reply(struct.pack(">BB", fc, cnt * 2) + struct.pack(">" + "H" * cnt, *vals))
            elif fc == 2:
                start, cnt = struct.unpack(">HH", body[1:5])
                nb = (cnt + 7) // 8
                reply(struct.pack(">BB", fc, nb) + bytes(nb))  # all alarms clear
            elif fc == 6:
                addr, val = struct.unpack(">HH", body[1:5])
                if addr == 0: SP["v"] = val
                reply(body[:5])
            else:
                reply(struct.pack(">BB", fc | 0x80, 1))
    finally:
        conn.close()

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--port", type=int, default=1502)
    a = ap.parse_args()
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", a.port)); srv.listen(8)
    print(f"XDU1350B Modbus TCP emulator on 127.0.0.1:{a.port} (FC02/03/04/06)")
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()
