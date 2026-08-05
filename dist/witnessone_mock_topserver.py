#!/usr/bin/env python3
"""
WitnessONE mock TOP Server  ·  Developed by MG
=================================================
Emulates the two HTTP surfaces WitnessONE's LIVE mode talks to, with the same
paths, auth, JSON property names and status codes as the real Kepware-platform
Configuration API (TOP Server v6/v7) and the IoT Gateway REST Server:

  Configuration API   /config/v1/about, /project/channels[...devices[...tags]]
                      Basic auth (Administrator / witness), 201/207 semantics,
                      PROJECT_ID response header, CORS *
  IoT Gateway style   /iotgateway/browse | /read?ids=... | /write
                      readResults [{id,s,r,v,t}] with a live XDU1350B physics sim

Run:      python3 witnessone_mock_topserver.py            (port 57418)
          python3 witnessone_mock_topserver.py --port 5711
Then in WitnessONE:  mode LIVE · API http://127.0.0.1:57418
                     user Administrator · password witness
                     IoT Gateway URL http://127.0.0.1:57418   (same port here)

Stdlib only — no pip installs needed on the commissioning laptop.
"""
import json, time, base64, argparse, math, random, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

USER, PASSWORD = "Administrator", "witness"
PROJECT_ID = 3706075985

# ---------------- seeded project (what an existing site server might hold) ----
PROJECT = {
    "CH_PLANT": {
        "props": {"common.ALLTYPES_NAME": "CH_PLANT",
                  "servermain.MULTIPLE_TYPES_DEVICE_DRIVER": "Modbus TCP/IP Ethernet"},
        "devices": {
            "AHU_07": {"props": {"common.ALLTYPES_NAME": "AHU_07",
                                 "servermain.MULTIPLE_TYPES_DEVICE_DRIVER": "Modbus TCP/IP Ethernet",
                                 "servermain.DEVICE_ID_STRING": "192.168.10.31.1"},
                       "tags": {"Supply_Temp": {"common.ALLTYPES_NAME": "Supply_Temp",
                                                "servermain.TAG_ADDRESS": "30001",
                                                "servermain.TAG_DATA_TYPE": 4}}},
        },
    }
}

# ---------------- tiny XDU1350B physics (raw register values, SPL gains) ------
T0 = time.time()
def _n(a): return (random.random()*2-1)*a
def sim_state():
    t = time.time()-T0
    sp = SIM_SP["v"]
    t2 = sp + 0.18*math.sin(t/9) + _n(0.05)
    load = 620 + 14*math.sin(t/47)
    secflow = 700 + 8*math.sin(t/13) + _n(3)
    dT = load*14.33/max(secflow,60)
    t4 = t2 + dT + _n(0.05)
    t1 = 26.5 + 0.6*math.sin(t/120)
    priflow = 465 + 6*math.sin(t/17)
    t5 = t1 + load*14.33/max(priflow,60)
    ps1 = 1.18 + _n(0.005); ps2 = ps1 + 1.17 + _n(0.01)
    p1 = 61 + _n(0.4); p2 = 60.5 + _n(0.4); p3 = 0.0
    cv = 46 + 2.2*math.sin(t/22)
    return {
        "30001": 5,
        "30003": p1, "30004": p2, "30005": p3,
        "40001": sp*10,
        "30008": cv, "30010": cv,
        "30007": cv, "30009": cv,
        "30011": t1*10, "30020": t5*10, "30015": t2*10, "30019": t4*10,
        "30028": 262 + _n(1), "30029": 250 + _n(1),
        "30026": ps2*100, "30023": ps1*100, "30027": (ps2-ps1)*100,
        "30031": priflow, "30032": secflow,
        "30041": 6.8+_n(.2), "30042": 7.4+_n(.2), "30043": 6.2+_n(.2),
        "10001": 0, "10002": 0, "10020": 0, "10021": 0,
        "10023": 0, "10024": 0, "10025": 0, "10029": 0, "10039": 0,
    }
SIM_SP = {"v": 32.0}

def find_tag(tag_id):
    parts = tag_id.split(".")
    if len(parts) < 3: return None
    ch, dev, name = parts[0], parts[1], ".".join(parts[2:])
    d = PROJECT.get(ch, {}).get("devices", {}).get(dev)
    if not d: return None
    return d["tags"].get(name)

# ---------------- HTTP ----------------
class H(BaseHTTPRequestHandler):
    server_version = "TOPServer-Mock/7.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type")
    def _json(self, code, obj, project_header=True):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        if project_header: self.send_header("Project_ID", str(PROJECT_ID))
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def _authed(self):
        h = self.headers.get("Authorization", "")
        ok = h == "Basic " + base64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
        if not ok: self._json(401, {"code": 401, "message": "Unauthorized"}, False)
        return ok
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"null") if n else None
    def log_message(self, fmt, *a): print(f"  [{time.strftime('%H:%M:%S')}] {self.command} {self.path}")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    # ---------- GET ----------
    def do_GET(self):
        u = urlparse(self.path); p = [x for x in u.path.split("/") if x]
        # IoT-gateway style live surface (no auth needed if anonymous; accept both)
        if u.path.startswith("/iotgateway/browse"):
            ids = [f"{c}.{d}.{t}" for c, ch in PROJECT.items()
                   for d, dv in ch["devices"].items() for t in dv["tags"]]
            return self._json(200, {"browseResults": [{"id": i} for i in ids],
                                    "succeeded": True, "reason": ""}, False)
        if u.path.startswith("/iotgateway/read"):
            ids = parse_qs(u.query).get("ids", [])
            st = sim_state(); now = int(time.time()*1000); out = []
            for i in ids:
                tg = find_tag(i)
                if not tg:
                    out.append({"id": i, "s": False, "r": "Unknown tag id", "v": None, "t": now}); continue
                addr = str(tg.get("servermain.TAG_ADDRESS", ""))
                v = st.get(addr)
                if v is None:
                    out.append({"id": i, "s": False, "r": f"No data at address {addr}", "v": None, "t": now})
                else:
                    out.append({"id": i, "s": True, "r": "", "v": round(v) if not addr.startswith("1") else int(v), "t": now})
            return self._json(200, {"readResults": out}, False)

        if not self._authed(): return
        if u.path == "/config/v1/about":
            return self._json(200, {"product_name": "TOP Server (WitnessONE mock)",
                                    "product_id": "013",
                                    "product_version": "V7.1.245.0",
                                    "product_version_major": 7, "product_version_minor": 1})
        if u.path == "/config/v1/doc":
            return self._json(200, {"doc": "mock", "drivers": ["Modbus TCP/IP Ethernet"]})
        if p[:3] == ["config", "v1", "project"]:
            rest = p[3:]
            if not rest:
                return self._json(200, {"PROJECT_ID": PROJECT_ID, "common.ALLTYPES_NAME": "MockProject"})
            if rest == ["channels"]:
                return self._json(200, [c["props"] | {"PROJECT_ID": PROJECT_ID} for c in PROJECT.values()])
            if len(rest) >= 2 and rest[0] == "channels":
                ch = PROJECT.get(rest[1])
                if not ch: return self._json(404, {"code": 404, "message": "Channel not found"})
                if len(rest) == 2: return self._json(200, ch["props"])
                if rest[2] == "devices":
                    if len(rest) == 3:
                        return self._json(200, [d["props"] for d in ch["devices"].values()])
                    dev = ch["devices"].get(rest[3])
                    if not dev: return self._json(404, {"code": 404, "message": "Device not found"})
                    if len(rest) == 4: return self._json(200, dev["props"])
                    if rest[4] == "tags":
                        return self._json(200, list(dev["tags"].values()))
        self._json(404, {"code": 404, "message": "Not found"})

    # ---------- POST (create) ----------
    def do_POST(self):
        u = urlparse(self.path); p = [x for x in u.path.split("/") if x]
        if u.path.startswith("/iotgateway/write"):
            body = self._body() or []
            out = []
            for w in body:
                tg = find_tag(w.get("id", ""))
                if tg and str(tg.get("servermain.TAG_ADDRESS")) == "40001":
                    try: SIM_SP["v"] = float(w.get("v"))/10.0
                    except Exception: pass
                out.append({"id": w.get("id"), "s": bool(tg), "r": "" if tg else "Unknown tag id"})
            return self._json(200, {"writeResults": out}, False)

        if not self._authed(): return
        body = self._body()
        if p[:4] == ["config", "v1", "project", "channels"]:
            rest = p[4:]
            if not rest:  # create channel
                name = body.get("common.ALLTYPES_NAME")
                if not name: return self._json(400, {"code": 400, "message": "Missing common.ALLTYPES_NAME"})
                if name in PROJECT: return self._json(400, {"code": 400, "message": f"Item '{name}' already exists"})
                if not re.match(r"^[A-Za-z0-9_ ]+$", name):
                    return self._json(400, {"code": 400, "message": "Invalid name"})
                PROJECT[name] = {"props": dict(body), "devices": {}}
                return self._json(201, {"code": 201, "message": "Created"})
            ch = PROJECT.get(rest[0])
            if not ch: return self._json(404, {"code": 404, "message": "Channel not found"})
            if rest[1:] == ["devices"]:
                name = body.get("common.ALLTYPES_NAME")
                if name in ch["devices"]:
                    return self._json(400, {"code": 400, "message": f"Item '{name}' already exists"})
                ch["devices"][name] = {"props": dict(body), "tags": {}}
                return self._json(201, {"code": 201, "message": "Created"})
            if len(rest) >= 3 and rest[1] == "devices" and rest[3:] == ["tags"]:
                dev = ch["devices"].get(rest[2])
                if not dev: return self._json(404, {"code": 404, "message": "Device not found"})
                items = body if isinstance(body, list) else [body]
                results, any_fail = [], False
                for it in items:
                    nm = (it or {}).get("common.ALLTYPES_NAME")
                    if not nm or nm in dev["tags"]:
                        results.append({"code": 400, "message": f"Item '{nm}' already exists or invalid"}); any_fail = True
                    else:
                        dev["tags"][nm] = dict(it)
                        results.append({"code": 201, "message": "Created"})
                if len(items) == 1 and not any_fail:
                    return self._json(201, {"code": 201, "message": "Created"})
                return self._json(207 if any_fail else 201, results)
        self._json(404, {"code": 404, "message": "Not found"})

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=57418)
    a = ap.parse_args()
    print(f"WitnessONE mock TOP Server · http://127.0.0.1:{a.port}")
    print(f"  Config API : /config/v1/...   (user {USER} · password {PASSWORD})")
    print(f"  Live data  : /iotgateway/read|write|browse   (anonymous, CORS *)")
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
