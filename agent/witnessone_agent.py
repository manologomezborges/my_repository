#!/usr/bin/env python3
"""
WitnessONE  ·  single-file app: agent + UI + app window  ·  Developed by MG
===========================================================================
Double-click (or `python3 witnessone_agent.py`) and you get the whole tool:
the local agent starts, the WitnessONE UI is served at 127.0.0.1:5710, and an
app-mode window opens (Edge/Chrome `--app` — one window, no tabs, no address
bar; nothing to install on Windows 10/11).  Flags:

  --demo-device     also start the built-in XDU1350B Modbus TCP emulator on
                    --demo-port (default 1502) — full end-to-end test with
                    ONE file and zero dependencies
  --headless        don't open the window (service/CI mode)
  --port 5710       agent/UI port
================================================================
Runs on the commissioning laptop and gives the WitnessONE UI native powers a
browser can't have:

  /modbus/*      real Modbus TCP (raw sockets): subnet discovery + fingerprint,
                 block reads of a device template's registers, guarded FC06 writes
  /registry/*    versioned device-template registry (make/model/fw/SPL) served
                 from ./templates — pulls/pushes against a central registry DB
                 when --remote is set; VERIFY touches last-checked, PROPOSE queues
                 a commit exactly like the future DB workflow
  /records/*     SQLite archive of every witness-test run (audit trail)
  /proxy/config/* , /proxy/iot/*   CORS-free forwarding to TOP Server APIs
  /              serves the WitnessONE UI (dist/WitnessONE.html) if present

Stdlib only — copy this file (plus templates/) to any laptop and run:
  python3 witnessone_agent.py [--port 5710] [--topserver https://127.0.0.1:57418]
                              [--iot URL] [--remote https://registry.example/api]
"""
import json, os, sys, ssl, time, sqlite3, socket, struct, argparse, threading, datetime, shutil, subprocess, hashlib
import urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# Frozen-exe aware paths (PyInstaller): writable state lives beside the .exe;
# read-only bundled resources live in the extraction dir (_MEIPASS).
FROZEN = getattr(sys, "frozen", False)
HERE = os.path.dirname(os.path.abspath(sys.executable if FROZEN else __file__))
BUNDLE = getattr(sys, "_MEIPASS", HERE)
ARGS = None
VERSION = "0.3.0"

# ---------------- registry store v2: devices + SELECTABLE points-list revisions ----
# devices/<id>.json               identity + layout + fw list (one per make·model)
# pointslists/<id>/<revId>.json   one file PER SPL REVISION (v4.17 … SPL 1.0, drafts)
# Approved revisions are IMMUTABLE here — field changes save NEW field-draft
# revision files; the central DB approves and publishes them as new revisions.
def _slug(x):
    import re as _re
    return _re.sub(r"[^a-z0-9.]+", "-", str(x).lower()).strip("-")

def _split_v1(t):
    rid = _slug(t["registry"].get("splVersion") or "spl")
    dev = {"schema": "witnessone.device/2", "id": t["id"], "class": t.get("class"),
           "identity": t["identity"], "layout": t.get("layout"), "fwtScript": t.get("fwtScript"),
           "registry": {k: t["registry"].get(k) for k in
                        ("version", "lastVerified", "verifiedBy", "source", "complianceStatus")},
           "defaultPointsList": rid}
    rev = {"schema": "witnessone.pointslist/2", "revId": rid, "device": t["id"],
           "splVersion": t["registry"].get("splVersion"), "status": "approved",
           "appliesToFw": t["identity"].get("firmwares", []), "basedOn": None,
           "approvedBy": t["registry"].get("verifiedBy"),
           "approvedDate": t["registry"].get("lastVerified"), "spl": t["spl"]}
    return dev, rev

_BASE_CACHE = [None]
_REG_CACHE = {"sig": None, "devices": None, "lists": None}
def _reg_sig(base):
    sig = 0.0; n = 0
    for root in ("devices", "pointslists"):
        p = os.path.join(base, root)
        for dirpath, _, files in os.walk(p):
            for f in files:
                if f.endswith(".json"):
                    try: sig += os.path.getmtime(os.path.join(dirpath, f)); n += 1
                    except OSError: pass
    return (n, sig)

def store_base():
    for base in (HERE, os.path.abspath(os.path.join(HERE, ".."))):
        if os.path.isdir(os.path.join(base, "devices")): return base
    # migrate a v1 templates/ folder (repo, portable bundle or frozen seed) in place
    for base in (HERE, os.path.abspath(os.path.join(HERE, "..")), BUNDLE):
        tdir = os.path.join(base, "templates")
        if os.path.isdir(tdir):
            out = HERE if base == BUNDLE else base
            os.makedirs(os.path.join(out, "devices"), exist_ok=True)
            for f in sorted(os.listdir(tdir)):
                if not f.endswith(".json"): continue
                try: t = json.load(open(os.path.join(tdir, f)))
                except Exception as e: print("  ! bad template", f, e); continue
                dev, rev = _split_v1(t)
                json.dump(dev, open(os.path.join(out, "devices", dev["id"] + ".json"), "w"), indent=1)
                rd = os.path.join(out, "pointslists", dev["id"]); os.makedirs(rd, exist_ok=True)
                rf = os.path.join(rd, rev["revId"] + ".json")
                if not os.path.exists(rf): json.dump(rev, open(rf, "w"), indent=1)
            print(f"  registry: migrated v1 templates → v2 devices+pointslists in {out}")
            return out
    os.makedirs(os.path.join(HERE, "devices"), exist_ok=True)
    return HERE

def _base():
    if _BASE_CACHE[0] is None: _BASE_CACHE[0] = store_base()
    return _BASE_CACHE[0]

def registry_cached():
    """devices+lists served from memory; reloaded only when a JSON file changes."""
    base = _base(); sig = _reg_sig(base)
    if _REG_CACHE["sig"] != sig:
        _REG_CACHE["devices"] = _load_devices_disk()
        _REG_CACHE["lists"] = _load_lists_disk(_REG_CACHE["devices"])
        _REG_CACHE["sig"] = sig
    return _REG_CACHE["devices"], _REG_CACHE["lists"]

def tpl_dir():  # kept for callers that only need a path to show
    return os.path.join(_base(), "devices")

def _load_devices_disk():
    d = os.path.join(_base(), "devices"); out = []
    for f in sorted(os.listdir(d)):
        if f.endswith(".json"):
            try: out.append(json.load(open(os.path.join(d, f))))
            except Exception as e: print("  ! bad device", f, e)
    out.sort(key=lambda t: (t.get("id") != "vertiv-xdu1350b-cdu", t.get("identity", {}).get("make", "")))
    return out

def _load_lists_disk(devs):
    base = os.path.join(_base(), "pointslists"); out = {}
    for dev in devs:
        rd = os.path.join(base, dev["id"]); revs = []
        if os.path.isdir(rd):
            for f in sorted(os.listdir(rd)):
                if f.endswith(".json"):
                    try: revs.append(json.load(open(os.path.join(rd, f))))
                    except Exception as e: print("  ! bad points list", f, e)
        revs.sort(key=lambda r: (r.get("status") != "approved", r.get("revId", "")))
        out[dev["id"]] = revs
    return out

def load_devices(): return registry_cached()[0]
def load_lists():   return registry_cached()[1]

def synth_template(dev, rev):
    reg = dict(dev.get("registry") or {})
    reg.update({"splVersion": rev.get("splVersion"), "revId": rev.get("revId"),
                "revStatus": rev.get("status")})
    return {"schema": "witnessone.device-template/1", "id": dev["id"], "class": dev.get("class"),
            "identity": dev["identity"], "layout": dev.get("layout"),
            "fwtScript": dev.get("fwtScript"), "registry": reg, "spl": rev["spl"]}

def load_templates():
    lists = load_lists(); out = []
    for dev in load_devices():
        revs = lists.get(dev["id"]) or []
        if not revs: continue
        rev = next((r for r in revs if r.get("revId") == dev.get("defaultPointsList")), revs[0])
        out.append(synth_template(dev, rev))
    return out

def save_device(dev):
    json.dump(dev, open(os.path.join(_base(), "devices", dev["id"] + ".json"), "w"), indent=1)

def save_revision(dev_id, rev):
    rd = os.path.join(_base(), "pointslists", dev_id); os.makedirs(rd, exist_ok=True)
    rf = os.path.join(rd, _slug(rev["revId"]) + ".json")
    if os.path.exists(rf):
        try: ex = json.load(open(rf))
        except Exception: ex = {}
        if ex.get("status") == "approved":
            return None  # approved revisions are immutable on this laptop
    json.dump(rev, open(rf, "w"), indent=1)
    return os.path.basename(rf)

def save_template(t):  # legacy path (remote sync still speaks v1): split + store as v2
    dev, rev = _split_v1(t)
    save_device(dev)
    # Route through save_revision so the approved-revision immutability guard
    # applies here too — an existing 'approved' pointslist is never overwritten
    # (the central DB publishes changes as NEW revisions, not in place).
    return save_revision(dev["id"], rev)

def _ssl_ctx():
    """Verifying TLS context (default). Verification is disabled ONLY when the
    operator explicitly passes --insecure-tls for a known self-signed lab server
    — never silently, so an on-path attacker can't MITM the forwarded TOP Server
    credentials or poison synced registry templates."""
    ctx = ssl.create_default_context()
    if ARGS is not None and getattr(ARGS, "insecure_tls", False):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx

def remote_call(method, path, body=None):
    if not ARGS.remote: return None
    rq = urllib.request.Request(ARGS.remote.rstrip("/") + path,
        data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Content-Type": "application/json"})
    ctx = _ssl_ctx()
    try:
        with urllib.request.urlopen(rq, context=ctx, timeout=8) as r:
            return {"ok": True, "status": r.status, "data": json.loads(r.read() or b"null")}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ---------------- records (SQLite) ----------------
DB_PATH = os.path.join(HERE, "witnessone_records.db")
def db():
    c = sqlite3.connect(DB_PATH)
    c.execute("""CREATE TABLE IF NOT EXISTS runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, device TEXT, overall TEXT,
        data_source TEXT, payload TEXT)""")
    # v0.8.3 P2: tamper-evidence digest. Migration-safe — add the column only if
    # an older DB predates it, so existing records keep working.
    cols = {r[1] for r in c.execute("PRAGMA table_info(runs)").fetchall()}
    if "digest" not in cols:
        c.execute("ALTER TABLE runs ADD COLUMN digest TEXT")
    return c

def run_digest(payload):
    """SHA-256 over the canonical JSON of a run payload, with any existing
    'digest' field excluded from its own input so the value is reproducible.
    Canonical = sorted keys, compact separators, UTF-8."""
    src = {k: v for k, v in payload.items() if k != "digest"} if isinstance(payload, dict) else payload
    canon = json.dumps(src, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()

# ---------------- Modbus TCP client (raw sockets) ----------------
class ModbusException(IOError):
    """Protocol-level exception response (e.g. illegal data address) from a
    HEALTHY socket — distinct from a transport/socket failure. Callers must not
    tear down the session or trip the circuit breaker on this."""
    pass

class Modbus:
    def __init__(self, ip, port=502, unit=1, timeout=1.2):
        self.ip, self.port, self.unit, self.timeout = ip, int(port), int(unit), timeout
        self.tid = 0; self.sock = None
    def connect(self):
        self.sock = socket.create_connection((self.ip, self.port), timeout=self.timeout)
    def close(self):
        try: self.sock and self.sock.close()
        except Exception: pass
    def _rt(self, fc, payload):
        self.tid = (self.tid + 1) & 0xFFFF
        pdu = struct.pack(">B", fc) + payload
        adu = struct.pack(">HHHB", self.tid, 0, len(pdu) + 1, self.unit) + pdu
        self.sock.sendall(adu)
        hdr = self._recvn(7)
        (tid, proto, ln, unit) = struct.unpack(">HHHB", hdr)
        body = self._recvn(ln - 1)
        if body[0] & 0x80:
            raise ModbusException(f"Modbus exception fc={fc} code={body[1]}")
        return body
    def _recvn(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk: raise IOError("connection closed")
            buf += chunk
        return buf
    def read_words(self, fc, start0, count):   # fc 3|4
        out = []
        while count > 0:
            n = min(count, 120)
            body = self._rt(fc, struct.pack(">HH", start0, n))
            out += list(struct.unpack(">" + "H" * n, body[2:2 + 2 * n]))
            start0 += n; count -= n
        return out
    def read_bits(self, fc, start0, count):    # fc 1|2
        body = self._rt(fc, struct.pack(">HH", start0, count))
        bits = []
        for i in range(count):
            bits.append((body[2 + i // 8] >> (i % 8)) & 1)
        return bits
    def write_reg(self, start0, value):        # fc 6
        self._rt(6, struct.pack(">HH", start0, value & 0xFFFF))
        return True

def addr_split(addr):
    """SPL 5- or 6-digit address -> (kind, zero-based offset).
    6-digit: 4xxxxx holding · 3xxxxx input · 1xxxxx discrete (v4.17 lists, PM8000-as-4xxxxx)
    5-digit: 4xxxx  holding · 3xxxx  input · 1xxxx  discrete (SPL 1.0)"""
    a = int(addr)
    if a >= 400001: return ("hold", a - 400001)
    if a >= 300001: return ("input", a - 300001)
    if a >= 100001: return ("disc", a - 100001)
    if a >= 40001:  return ("hold", a - 40001)
    if a >= 30001:  return ("input", a - 30001)
    if a >= 10001:  return ("disc", a - 10001)
    return ("coil", a - 1)

def template_offsets(template):
    """All (kind, offset, addr) pairs a template needs, expanding 32-bit spans."""
    out = {"input": [], "hold": [], "disc": []}
    for p in template["spl"]["points"]:
        span = 2 if p.get("span32") else 1
        for a in (p.get("addrs") or []):
            k, off = addr_split(a)
            for s in range(span):
                out[k].append((off + s, int(a) + s))
    return out

_FC_FOR_KIND = {"input": 4, "hold": 3, "disc": 2, "coil": 1}
def validate_point_fcs(template):
    """Flag points whose declared readFC/writeFC disagrees with the Modbus table
    implied by the address prefix (addr_split). The Agent resolves the table from
    the ADDRESS, so a mismatch means the SPL's declared FC is silently ignored and
    a different register is read/written — surface it rather than certify blindly."""
    def _fc(v):
        # A declared FC only counts if it parses to an int; strings like "N/A"
        # or "" are "not applicable" markers, not a contradictory declaration.
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    warns = []
    for p in (template.get("spl", {}).get("points") or []):
        pid = p.get("id") or p.get("name") or "?"
        for a in (p.get("addrs") or []):
            kind, _ = addr_split(a)
            exp = _FC_FOR_KIND.get(kind)
            rfc = _fc(p.get("readFC"))
            if rfc is not None and exp is not None and rfc != exp:
                warns.append(f"{template.get('id')}/{pid}: addr {a} is {kind} "
                             f"(FC{exp}) but declares readFC={rfc}")
            wfc = _fc(p.get("writeFC"))
            if wfc is not None and kind in ("input", "disc"):
                warns.append(f"{template.get('id')}/{pid}: addr {a} is read-only "
                             f"{kind} but declares writeFC={wfc}")
    return warns

def cluster(offs, gap=24, maxlen=110):
    """Sorted unique offsets -> [(lo,hi)] blocks, splitting on gaps (sparse maps)."""
    offs = sorted({o for o, _ in offs})
    blocks = []
    for o in offs:
        if blocks and o - blocks[-1][1] <= gap and o - blocks[-1][0] < maxlen:
            blocks[-1][1] = o
        else:
            blocks.append([o, o])
    return blocks

# Field-safe connection policy: ONE persistent TCP session per device, serialized
# requests, bounded block sizes — no connect/disconnect churn on real equipment.
_CONN = {}; _CONN_LOCK = threading.Lock()
def _conn(ip, port, unit):
    key = (ip, int(port), int(unit))
    with _CONN_LOCK:
        ent = _CONN.get(key)
        if not ent:
            ent = {"m": None, "lock": threading.Lock()}
            _CONN[key] = ent
    return key, ent
_DOWN = {}
def with_device(ip, port, unit, fn):
    """Run fn(modbus) on the persistent session; one reconnect attempt on socket error.
    Circuit breaker: after a connect failure the device is marked DOWN for 5 s and
    callers fail instantly — no timeout pile-ups against unreachable equipment."""
    key, ent = _conn(ip, port, unit)
    if _DOWN.get(key, 0) > time.time():
        raise IOError("device down — backing off (retry in a few seconds)")
    with ent["lock"]:
        for attempt in (0, 1):
            try:
                if ent["m"] is None:
                    ent["m"] = Modbus(ip, port, unit); ent["m"].connect()
                r = fn(ent["m"])
                _DOWN.pop(key, None)
                return r
            except ModbusException:
                # device answered a protocol exception on a healthy socket: it is
                # reachable. Do NOT close/reconnect or trip the breaker — surface
                # the exception to the caller (block reads narrow it per-register).
                _DOWN.pop(key, None)
                raise
            except IOError as e:
                try: ent["m"] and ent["m"].close()
                except Exception: pass
                ent["m"] = None
                if attempt:
                    _DOWN[key] = time.time() + 5.0
                    raise
        return None  # unreachable
    # success path clears any breaker state


_OFF_CACHE = {}
def template_offsets_cached(template):
    key = (template.get("id"), template.get("registry", {}).get("revId"),
           len(template["spl"]["points"]))
    if key not in _OFF_CACHE: _OFF_CACHE[key] = template_offsets(template)
    return _OFF_CACHE[key]

def read_template_block(ip, port, unit, template):
    """Clustered block reads of everything the template maps (sparse-map friendly);
    returns {addr: raw register/bit value} — the UI combines spans/bits/signs."""
    kinds = template_offsets_cached(template)
    def go(m):
        out = {}
        for k, fc, rd in (("input", 4, "w"), ("hold", 3, "w"), ("disc", 2, "b")):
            offs = kinds[k]
            if not offs: continue
            omap = {}
            for off, addr in offs: omap.setdefault(off, []).append(addr)
            for lo, hi in cluster(offs):
                try:
                    vals = (m.read_words(fc, lo, hi - lo + 1) if rd == "w"
                            else m.read_bits(fc, lo, hi - lo + 1))
                    for off in range(lo, hi + 1):
                        for addr in omap.get(off, []):
                            out[str(addr)] = vals[off - lo]
                except ModbusException:
                    # a cluster spans an unmapped register the device rejects;
                    # read the template's own mapped offsets one at a time and
                    # skip only the offending ones (session stays up).
                    for off in sorted(o for o in omap if lo <= o <= hi):
                        try:
                            v = (m.read_words(fc, off, 1)[0] if rd == "w"
                                 else m.read_bits(fc, off, 1)[0])
                        except ModbusException:
                            continue
                        for addr in omap.get(off, []):
                            out[str(addr)] = v
        return out
    return with_device(ip, port, unit, go), int(time.time() * 1000)

def scan_registers(ip, port, unit, ranges, chunk=12, delay=0.04):
    """Gentle register-space sweep at a KNOWN device: small chunked reads with
    inter-request gaps; Modbus 'illegal address' exceptions narrow to singles."""
    found, probed, refused = [], 0, 0
    def rd(m, fc, off, n):
        return m.read_words(fc, off, n) if fc in (3, 4) else m.read_bits(fc, off, n)
    def go(m):
        nonlocal probed, refused
        for rg in ranges:
            fc, start, cnt = int(rg["fc"]), int(rg["start"]), int(rg["count"])
            # template-derived ranges carry their own base (6-digit lists too);
            # ad-hoc ranges default to the 5-digit namespace.
            base = int(rg["base"]) if rg.get("base") is not None else \
                   (30001 if fc == 4 else (40001 if fc == 3 else 10001))
            off = start
            while off < start + cnt:
                n = min(chunk, start + cnt - off)
                probed += n
                try:
                    vals = rd(m, fc, off, n)
                    for i, v in enumerate(vals):
                        found.append({"fc": fc, "addr": base + off + i, "value": int(v)})
                except IOError as e:
                    if "exception" not in str(e): raise      # socket-level: bubble to reconnect
                    refused += 1                              # illegal address → probe singles
                    for kk in range(n):
                        try:
                            v = rd(m, fc, off + kk, 1)[0]
                            found.append({"fc": fc, "addr": base + off + kk, "value": int(v)})
                        except IOError as e2:
                            if "exception" not in str(e2): raise
                        time.sleep(delay)
                off += n
                time.sleep(delay)
        return True
    with_device(ip, port, unit, go)
    return {"found": found, "probed": probed, "refusedChunks": refused}

def _template_match(m, template, sample=8):
    """Score how well a device matches THIS template by reading a sample of the
    template's own points and checking each responds with an in-range value.
    Returns (score 0..1, points_tried). A device that rejects the template's
    address map (illegal address) or answers implausible values scores low, so
    the wrong template can no longer win by default."""
    pts = []
    for p in (template.get("spl", {}).get("points") or []):
        addrs = p.get("addrs") or []
        if not addrs: continue
        pts.append((addrs[0], p.get("gain") or 1, p.get("min"), p.get("max"),
                    bool(p.get("span32"))))
        if len(pts) >= sample: break
    if not pts: return 0.0, 0
    total = 0.0; tried = 0
    for addr, gain, lo, hi, span32 in pts:
        kind, off = addr_split(addr)
        tried += 1
        try:
            if kind in ("input", "hold"):
                fc = 4 if kind == "input" else 3
                val = m.read_words(fc, off, 2 if span32 else 1)[0]
            elif kind == "disc":
                val = m.read_bits(2, off, 1)[0]
            else:
                val = m.read_bits(1, off, 1)[0]
        except Exception:
            continue  # address not implemented as this table → 0 for this point
        if lo is not None and hi is not None and hi > lo:
            # accept either raw or gain-scaled reading inside the declared range
            total += 1.0 if (lo <= val <= hi or lo <= val * gain <= hi) else 0.3
        else:
            total += 0.6  # responded, but no range to confirm against
    return (total / tried if tried else 0.0), tried

def fingerprint(ip, port, unit, templates):
    """Open a real Modbus session and pattern-match against the template library."""
    m = Modbus(ip, port, unit, timeout=0.9)
    try:
        m.connect()
    except Exception as e:
        return {"open": False, "error": str(e)}
    try:
        try: status = m.read_words(4, 0, 1)[0]
        except Exception: status = None
        try: pumps = m.read_words(4, 2, 3)
        except Exception: pumps = None
        try: alarms = m.read_bits(2, 0, 2)
        except Exception: alarms = None
        fp = {"open": True, "unitStatus": status, "pumps": pumps, "alarms": alarms}
        best = None  # (score, tried, template)
        for t in templates:
            score, tried = _template_match(m, t)
            if best is None or score > best[0]: best = (score, tried, t)
        # Require a strong, template-specific match against enough of its own
        # points before claiming an identity — never fabricate confidence.
        if best and best[1] >= 4 and best[0] >= 0.6:
            score, tried, t = best
            fp["match"] = {"templateId": t["id"], "make": t["identity"]["make"],
                          "model": t["identity"]["model"],
                          "fw": t["identity"]["firmwares"][0],
                          "confidence": round(min(99.0, 100.0 * score), 1)}
        return fp
    finally:
        m.close()

# ---------------- HTTP handler ----------------
UI_PATH = None
class H(BaseHTTPRequestHandler):
    server_version = "WitnessONE-Agent/" + VERSION
    _LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")
    def _allowed_origin(self):
        """The request Origin iff the agent may reflect it in ACAO, else None.
        Allowed: a localhost http(s) origin (the agent-served UI's own origin),
        and the literal 'null' origin that a browser sends for a page opened from
        file:// — WitnessONE's documented zero-install field mode is "open
        dist/WitnessONE.html" directly, and that page must still reach the local
        agent. Never '*' — a foreign http(s) page must not read agent responses.
        Absent Origin (same-origin navigation/GET) → None, and the caller simply
        omits ACAO, which same-origin requests don't need.

        Allowing 'null' does admit other null-origin contexts (sandboxed iframes,
        data: URLs); the anti-DNS-rebinding backbone stays the Host-header check
        in _guard(), which is origin-independent, so this is a bounded trade-off
        made to keep the documented file:// deployment working."""
        origin = self.headers.get("Origin")
        if not origin:
            return None
        if origin == "null":
            return "null"
        try:
            o = urlparse(origin)
        except Exception:
            return None
        if o.scheme in ("http", "https") and o.hostname in self._LOCAL_HOSTS:
            return origin
        return None
    def _guard(self):
        """Same-origin / anti-DNS-rebinding gate on every request. Blocks hostile
        cross-origin browser drive-by (CSRF write / SSRF scan) while leaving the
        local same-origin UI untouched. Returns True to proceed, else sends 403."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        if host and host not in self._LOCAL_HOSTS:
            self._json(403, {"error": "forbidden: unexpected Host (possible DNS rebinding)"})
            return False
        origin = self.headers.get("Origin")
        if origin:
            if self._allowed_origin() is None:
                self._json(403, {"error": "forbidden: cross-origin request blocked"})
                return False
        else:  # no Origin: fall back to Referer when present
            ref = self.headers.get("Referer")
            if ref:
                try: rh = urlparse(ref).hostname
                except Exception: rh = None
                if rh and rh not in self._LOCAL_HOSTS:
                    self._json(403, {"error": "forbidden: cross-origin referer blocked"})
                    return False
        return True
    def _cors(self):
        origin = self._allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type")
    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"null") if n else None
    def log_message(self, f, *a): print(f"  [{time.strftime('%H:%M:%S')}] {self.command} {self.path[:90]}")
    def do_OPTIONS(self):
        # Only satisfy CORS preflight for localhost origins; a foreign origin's
        # preflight fails, so the browser never issues the real (JSON) request.
        if self._allowed_origin() is None:
            self.send_response(403); self.end_headers(); return
        self.send_response(204); self._cors(); self.end_headers()

    def _proxy(self):
        which, rest = ("topserver", self.path[len("/proxy/config"):]) if self.path.startswith("/proxy/config") \
                      else ("iot", self.path[len("/proxy/iot"):])
        base = ARGS.topserver if which == "topserver" else ARGS.iot
        if not base: return self._json(502, {"error": f"agent started without --{which} URL"})
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        rq = urllib.request.Request(base.rstrip("/") + ("/config" + rest if which == "topserver" else "/iotgateway" + rest),
                                    data=body, method=self.command)
        for h in ("Authorization", "Content-Type"):
            if self.headers.get(h): rq.add_header(h, self.headers[h])
        ctx = _ssl_ctx()
        try:
            with urllib.request.urlopen(rq, context=ctx, timeout=10) as r:
                d = r.read(); code = r.status; pid = r.headers.get("Project_ID")
        except urllib.error.HTTPError as e:
            d = e.read(); code = e.code; pid = None
        except Exception as e:
            return self._json(502, {"error": str(e)})
        self.send_response(code); self._cors()
        if pid: self.send_header("Project_ID", pid)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(d))); self.end_headers(); self.wfile.write(d)

    def do_GET(self):
        if not self._guard(): return
        u = urlparse(self.path)
        if u.path.startswith("/proxy/"): return self._proxy()
        if u.path == "/agent/status":
            c = db(); n = c.execute("SELECT COUNT(*) FROM runs").fetchone()[0]; c.close()
            return self._json(200, {"agent": "witnessone", "version": VERSION,
                                    "templates": len(load_templates()), "records": n,
                                    "remoteRegistry": bool(ARGS.remote),
                                    "topserverProxy": bool(ARGS.topserver)})
        if u.path == "/registry/devices":
            return self._json(200, {"source": "agent", "devices": load_devices(),
                                    "pointslists": load_lists(), "templates": load_templates()})
        if u.path == "/modbus/read":
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            dev = next((d for d in load_devices() if d["id"] == q.get("template")), None)
            if not dev: return self._json(400, {"error": "unknown device id"})
            revs = load_lists().get(dev["id"]) or []
            rev = (next((r for r in revs if r.get("revId") == q.get("rev")), None)
                   or next((r for r in revs if r.get("revId") == dev.get("defaultPointsList")), None)
                   or (revs[0] if revs else None))
            if not rev: return self._json(400, {"error": "device has no points lists"})
            tpl = synth_template(dev, rev)
            try:
                vals, ts = read_template_block(q.get("ip", "127.0.0.1"), int(q.get("port", 502)),
                                               int(q.get("unit", 1)), tpl)
                return self._json(200, {"ok": True, "values": vals, "t": ts})
            except Exception as e:
                return self._json(502, {"ok": False, "error": str(e)})
        if u.path == "/records/runs":
            c = db(); rows = c.execute("SELECT id,ts,device,overall,data_source FROM runs ORDER BY id DESC LIMIT 100").fetchall(); c.close()
            return self._json(200, {"runs": [dict(zip(("id", "ts", "device", "overall", "dataSource"), r)) for r in rows]})
        if u.path.startswith("/records/verify/"):
            rid = u.path.rsplit("/", 1)[-1]
            c = db(); row = c.execute("SELECT payload,digest FROM runs WHERE id=?", (rid,)).fetchone(); c.close()
            if not row:
                return self._json(404, {"error": "not found"})
            stored_digest = row[1]
            recomputed = run_digest(json.loads(row[0]))
            # Intact iff the payload still hashes to the digest recorded at archive
            # time. An optional ?digest= lets a holder of a downloaded certificate
            # check its printed digest against the authoritative record.
            external = parse_qs(u.query).get("digest", [None])[0]
            out = {"id": int(rid), "digest": recomputed,
                   "storedDigest": stored_digest,
                   "match": (stored_digest == recomputed)}
            if external is not None:
                out["externalDigest"] = external
                out["externalMatch"] = (external == recomputed)
            return self._json(200, out)
        if u.path.startswith("/records/runs/"):
            rid = u.path.rsplit("/", 1)[-1]
            c = db(); row = c.execute("SELECT payload FROM runs WHERE id=?", (rid,)).fetchone(); c.close()
            return self._json(200, json.loads(row[0])) if row else self._json(404, {"error": "not found"})
        if u.path in ("/", "/index.html") and UI_PATH and os.path.exists(UI_PATH):
            d = open(UI_PATH, "rb").read()
            self.send_response(200); self._cors()
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(d))); self.end_headers(); self.wfile.write(d)
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._guard(): return
        u = urlparse(self.path)
        if u.path.startswith("/proxy/"): return self._proxy()
        body = self._body() or {}
        if u.path == "/modbus/discover":
            hosts = body.get("hosts") or []
            port, unit = int(body.get("port", 502)), int(body.get("unit", 1))
            tpls = load_templates(); results = []
            def probe(ip):
                try:
                    s = socket.create_connection((ip, port), timeout=0.35); s.close()
                except Exception:
                    results.append({"ip": ip, "port": port, "open": False}); return
                fp = fingerprint(ip, port, unit, tpls)
                results.append({"ip": ip, "port": port, **fp})
            th = [threading.Thread(target=probe, args=(h,)) for h in hosts[:254]]
            [t.start() for t in th]; [t.join() for t in th]
            return self._json(200, {"results": results})
        if u.path == "/modbus/scan":
            try:
                ranges = body.get("ranges")
                if not ranges and body.get("template"):
                    tpl = next((t for t in load_templates() if t["id"] == body["template"]), None)
                    if tpl:
                        ranges = []
                        kinds = template_offsets(tpl)
                        # offset -> original SPL addr, so scan results are reported
                        # in the template's OWN address form (5- or 6-digit).
                        addr_of = {(k, off): addr for k in kinds
                                   for off, addr in kinds[k]}
                        for k, fc in (("input", 4), ("hold", 3), ("disc", 2)):
                            for lo, hi in cluster(kinds[k], gap=40, maxlen=200):
                                base = addr_of[(k, lo)] - lo  # addr = base + offset
                                ranges.append({"fc": fc, "start": max(0, lo - 4),
                                               "count": (hi - lo + 1) + 12, "base": base})
                if not ranges:
                    ranges = [{"fc": 4, "start": 0, "count": 120},
                              {"fc": 3, "start": 0, "count": 50},
                              {"fc": 2, "start": 0, "count": 64}]
                res = scan_registers(body.get("ip", "127.0.0.1"), int(body.get("port", 502)),
                                     int(body.get("unit", 1)), ranges,
                                     chunk=int(body.get("chunk", 12)),
                                     delay=float(body.get("delayMs", 40)) / 1000.0)
                res["ok"] = True
                return self._json(200, res)
            except Exception as e:
                return self._json(502, {"ok": False, "error": str(e)})
        if u.path == "/net/ping":
            host = body.get("host", "127.0.0.1"); port = int(body.get("port", 502))
            res = {"host": host, "icmp": False, "tcp": False, "ok": False, "ms": None}
            t0 = time.time()
            try:  # real system ping (what a field tech would type)
                flags = ["-n", "1", "-w", "1500"] if os.name == "nt" else ["-c", "1", "-W", "2"]
                p = subprocess.run(["ping", *flags, host], capture_output=True, timeout=4)
                res["icmp"] = (p.returncode == 0)
            except Exception:
                pass
            if res["icmp"]: res["ms"] = int((time.time() - t0) * 1000)
            try:  # port 502 open is the stronger signal (ICMP is often blocked)
                t1 = time.time()
                sk = socket.create_connection((host, port), timeout=1.8); sk.close()
                res["tcp"] = True
                res["ms"] = res["ms"] or int((time.time() - t1) * 1000)
            except Exception as e:
                res["tcpErr"] = str(e)
            res["ok"] = res["icmp"] or res["tcp"]
            return self._json(200, res)
        if u.path == "/modbus/probe":
            # one register, one answer: the fastest possible "can I reach a Modbus point?"
            ip = body.get("ip", "127.0.0.1"); port = int(body.get("port", 502))
            unit = int(body.get("unit", 1)); addr = int(body.get("addr", 30001))
            t0 = time.time()
            try:
                kind, off = addr_split(addr)
                m = Modbus(ip, port, unit, timeout=2.5); m.connect()
                try:
                    if kind in ("input", "hold"):
                        v = m.read_words(4 if kind == "input" else 3, off, 1)[0]
                    else:
                        v = m.read_bits(2 if kind == "disc" else 1, off, 1)[0]
                finally:
                    m.close()
                return self._json(200, {"ok": True, "addr": addr, "kind": kind, "value": v,
                                        "ms": int((time.time() - t0) * 1000)})
            except Exception as e:
                return self._json(200, {"ok": False, "addr": addr, "error": str(e),
                                        "ms": int((time.time() - t0) * 1000)})
        if u.path == "/modbus/write":
            k, off = addr_split(body["addr"])
            if k != "hold": return self._json(400, {"ok": False, "error": "FC06 writes holding registers (4xxxx) only"})
            try:
                with_device(body["ip"], int(body.get("port", 502)), int(body.get("unit", 1)),
                            lambda m: m.write_reg(off, int(body["value"])))
                return self._json(200, {"ok": True, "addr": body["addr"], "value": int(body["value"])})
            except Exception as e:
                return self._json(502, {"ok": False, "error": str(e)})
        if u.path == "/records/runs":
            digest = run_digest(body or {})
            c = db()
            cur = c.execute("INSERT INTO runs(ts,device,overall,data_source,payload,digest) VALUES(?,?,?,?,?,?)",
                (body.get("finishedAt") or datetime.datetime.now().isoformat(),
                 f"{(body.get('meta') or {}).get('Make','?')} {(body.get('meta') or {}).get('Model','?')[:24]}",
                 body.get("overall", "?"), body.get("dataSource", "?"), json.dumps(body), digest))
            c.commit(); rid = cur.lastrowid; c.close()
            return self._json(201, {"ok": True, "id": rid, "digest": digest})
        if u.path == "/registry/sync":
            r = remote_call("GET", "/devices")
            if r is None: return self._json(200, {"ok": False, "msg": "no --remote registry configured; local templates remain authoritative"})
            if not r["ok"]: return self._json(502, {"ok": False, "msg": "remote registry unreachable: " + r["error"]})
            tpls = r["data"].get("templates", r["data"] if isinstance(r["data"], list) else [])
            for t in tpls: save_template(t)
            return self._json(200, {"ok": True, "pulled": len(tpls)})
        if u.path.startswith("/registry/devices/") and u.path.endswith("/verify"):
            tid = u.path.split("/")[3]
            devs = {d["id"]: d for d in load_devices()}
            if tid not in devs: return self._json(404, {"ok": False, "msg": "unknown device"})
            d = devs[tid]; today = str(datetime.date.today())
            d.setdefault("registry", {})["lastVerified"] = today
            d["registry"]["verifiedBy"] = body.get("by", "?")
            save_device(d)
            r = remote_call("PATCH", f"/devices/{tid}/verify", {"date": today, "by": body.get("by")})
            queued = r is None or not r.get("ok")
            return self._json(200, {"ok": True, "lastVerified": today,
                                    "pushed": (r or {}).get("ok", False), "queued": queued})
        if u.path.startswith("/registry/devices/") and u.path.endswith("/pointslists"):
            tid = u.path.split("/")[3]
            rev = body.get("rev")
            if not (isinstance(rev, dict) and rev.get("revId") and rev.get("spl")):
                return self._json(400, {"ok": False, "msg": "body.rev must be a points-list revision"})
            if rev.get("status") == "approved":
                return self._json(409, {"ok": False, "msg": "approved revisions are published by the central DB, not saved locally"})
            fn = save_revision(tid, rev)
            if fn is None: return self._json(409, {"ok": False, "msg": "refusing to overwrite an approved revision"})
            return self._json(200, {"ok": True, "file": fn, "revId": rev["revId"]})
        if u.path.startswith("/registry/devices/") and u.path.endswith("/propose"):
            tid = u.path.split("/")[3]
            # Field changes arrive as a DRAFT points-list revision (v2) or, from older
            # clients, a whole template (v1). Persist locally NOW, queue for the DB.
            applied = False
            if isinstance(body.get("rev"), dict) and body["rev"].get("spl"):
                if body["rev"].get("status") != "approved" and save_revision(tid, body["rev"]):
                    applied = True
            elif isinstance(body.get("template"), dict) and body["template"].get("id") == tid:
                t = body["template"]
                t.setdefault("registry", {})["fieldUpdated"] = datetime.datetime.now().isoformat()
                # A field propose is a DRAFT, never an approved publish: coerce the
                # derived revision to a suffixed field-draft so it cannot overwrite
                # the approved witness-of-record SPL (_split_v1 hardcodes 'approved').
                dev, rev = _split_v1(t)
                rev["basedOn"] = rev["revId"]
                rev["revId"] = _slug(rev["revId"]) + "-field-" + str(int(time.time()))
                rev["status"] = "field-draft"
                applied = bool(save_revision(tid, rev))
            pend = os.path.join(HERE, "pending_commits"); os.makedirs(pend, exist_ok=True)
            fn = os.path.join(pend, f"{tid}-{int(time.time())}.json")
            json.dump({"templateId": tid, "revId": body.get("revId"), "by": body.get("by"),
                       "note": body.get("note"), "rev": body.get("rev"),
                       "template": body.get("template"),
                       "ts": datetime.datetime.now().isoformat()}, open(fn, "w"), indent=1)
            r = remote_call("POST", f"/devices/{tid}/commits", body)
            return self._json(200, {"ok": True, "applied": applied,
                                    "pushed": (r or {}).get("ok", False),
                                    "queued": r is None or not r.get("ok"), "file": os.path.basename(fn)})
        self._json(404, {"error": "not found"})

# ---------------- built-in demo device (real Modbus TCP XDU1350B emulator) ----------------
import math, random
_DT0 = time.time(); _DSP = {"v": 320}
def _dn(a): return (random.random() * 2 - 1) * a
def _dstate():
    t = time.time() - _DT0; sp = _DSP["v"] / 10
    t2 = sp + 0.18 * math.sin(t / 9) + _dn(0.05)
    load = 620 + 14 * math.sin(t / 47); secflow = 700 + 8 * math.sin(t / 13) + _dn(3)
    t4 = t2 + load * 14.33 / max(secflow, 60); t1 = 26.5 + 0.6 * math.sin(t / 120)
    priflow = 465 + 6 * math.sin(t / 17); t5 = t1 + load * 14.33 / max(priflow, 60)
    ps1 = 1.18 + _dn(0.005); ps2 = ps1 + 1.17 + _dn(0.01); cv = 46 + 2.2 * math.sin(t / 22)
    return {1: 5, 3: 61 + _dn(.5), 4: 60.5 + _dn(.5), 5: 0, 7: cv, 8: cv, 9: cv, 10: cv,
            21: t2 * 10 + 14,  # 30021: T2b sensor (new in fw 1.0b20 — not in SPL template)
            11: t1 * 10, 15: t2 * 10, 19: t4 * 10, 20: t5 * 10, 23: ps1 * 100, 26: ps2 * 100,
            27: (ps2 - ps1) * 100, 28: 262 + _dn(1), 29: 250 + _dn(1), 31: priflow, 32: secflow,
            41: 6.8 + _dn(.2), 42: 7.4 + _dn(.2), 43: 6.2 + _dn(.2)}
def _demo_conn(conn):
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
            def reply(pdu): conn.sendall(struct.pack(">HHHB", tid, 0, len(pdu) + 1, unit) + pdu)
            if fc in (3, 4):
                start, cnt = struct.unpack(">HH", body[1:5]); st = _dstate(); vals = []
                for i in range(cnt):
                    a = start + i + 1
                    v = st.get(a, 0) if fc == 4 else (_DSP["v"] if a == 1 else 0)
                    vals.append(max(0, int(round(v))) & 0xFFFF)
                reply(struct.pack(">BB", fc, cnt * 2) + struct.pack(">" + "H" * cnt, *vals))
            elif fc == 2:
                start, cnt = struct.unpack(">HH", body[1:5]); nb = (cnt + 7) // 8
                reply(struct.pack(">BB", fc, nb) + bytes(nb))
            elif fc == 6:
                addr, val = struct.unpack(">HH", body[1:5])
                if addr == 0: _DSP["v"] = val
                reply(body[:5])
            else: reply(struct.pack(">BB", fc | 0x80, 1))
    finally:
        conn.close()
# ---- generic template emulator: serves plausible values for ANY device template ----
def _plausible(name, units, lo, hi):
    n = (name or "").lower(); u = (units or "").lower()
    for kw, v in (("voltage a-n", 277), ("voltage b-n", 277), ("voltage c-n", 277),
                  ("voltage", 480), ("current unbal", 1.4), ("voltage unbal", 0.8),
                  ("current", 212), ("frequency", 60.0), ("factor", 0.95),
                  ("thd", 2.1), ("humidity", 52), ("kwh", 48210), ("kvar", 38),
                  ("kva", 172), ("kw", 165), ("power", 165000 if u in ("w", "") else 165),
                  ("temperature", 75 if "f" in u else 24), ("temp", 75 if "f" in u else 24),
                  ("battery amps", 12), ("amps", 45), ("minutes", 30), ("%", 55)):
        if kw in n: return float(v)
    if lo is not None and hi is not None and hi > lo: return (lo + hi) / 2.0
    return 42.0

def build_generic_maps(template):
    """address-space maps for the emulator, kept SEPARATE per Modbus table so
    holding (FC03) and input (FC04) never collide on a shared offset:
      words = {'hold': {off: fn(t)->word|word}, 'input': {...}}, bits = {disc off: bit}
    Coil ('coil' kind) addresses are not served by this emulator and are dropped."""
    words, bits = {"hold": {}, "input": {}}, {}
    order = template.get("wordOrder", "hilo")
    for p in template["spl"]["points"]:
        base = _plausible(p.get("name"), p.get("units"), p.get("min"), p.get("max"))
        gain = p.get("gain") or 1
        if p.get("min") is not None and p.get("max") is not None and p["max"] > p["min"]:
            base = min(max(base, p["min"] + (p["max"]-p["min"])*0.15), p["max"] - (p["max"]-p["min"])*0.15)
        for ai, a in enumerate(p.get("addrs") or []):
            k, off = addr_split(a)
            if k == "disc":
                bits[off] = 0
                continue
            if k not in ("hold", "input"):
                continue  # coils are not emulated on the FC03/FC04 word tables
            tgt = words[k]
            if p.get("bit") is not None:
                bit = int(p["bit"]); nl = (p.get("name") or "").lower()
                on = 1 if any(w in nl for w in ("closed", "spring", "connected", "ready", "normal", "on ")) else 0
                cur = tgt.get(off); prev = cur(0) if callable(cur) else 0
                word = (prev | (on << bit)) & 0xFFFF
                tgt[off] = (lambda w: (lambda t: w))(word)
            elif p.get("span32"):
                v = base * (1 + 0.004 * math.sin(time.time() / 9 + off))
                if p.get("regType") == "float32":
                    def mk(offc, basev):
                        def f(t):
                            val = basev * (1 + 0.004 * math.sin(t / 9 + offc))
                            w = struct.unpack(">HH", struct.pack(">f", val))
                            return w if order == "hilo" else (w[1], w[0])
                        return f
                    pair = mk(off, base)
                    tgt[off] = (lambda g: (lambda t: g(t)[0]))(pair)
                    tgt[off + 1] = (lambda g: (lambda t: g(t)[1]))(pair)
                else:  # 32int
                    def mk32(offc, basev, g):
                        def f(t):
                            raw = int(basev / g * (1 + 0.004 * math.sin(t / 9 + offc))) & 0xFFFFFFFF
                            hi, lo2 = (raw >> 16) & 0xFFFF, raw & 0xFFFF
                            return (hi, lo2) if order == "hilo" else (lo2, hi)
                        return f
                    pair = mk32(off, base, gain)
                    tgt[off] = (lambda g2: (lambda t: g2(t)[0]))(pair)
                    tgt[off + 1] = (lambda g2: (lambda t: g2(t)[1]))(pair)
            else:
                if (p.get("regType") == "Boolean") or (p.get("stateTable") and p.get("min") is None):
                    tgt[off] = (lambda t: 0)
                else:
                    def mk16(offc, basev, g, sub):
                        def f(t):
                            val = basev * (1 + 0.01 * math.sin(t / 7 + offc)) + sub * 0.7
                            raw = int(round(val / g))
                            return raw & 0xFFFF
                        return f
                    tgt[off] = mk16(off, base, gain, ai)
    return words, bits

def start_template_device(port, template):
    words, bits = build_generic_maps(template)
    t0 = time.time()
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
                def reply(pdu): conn.sendall(struct.pack(">HHHB", tid, 0, len(pdu) + 1, unit) + pdu)
                t = time.time() - t0
                if fc in (3, 4):
                    start, cnt = struct.unpack(">HH", body[1:5])
                    tbl = words["input"] if fc == 4 else words["hold"]
                    vals = []
                    for i in range(cnt):
                        fn = tbl.get(start + i)
                        vals.append((fn(t) if callable(fn) else (fn or 0)) & 0xFFFF)
                    reply(struct.pack(">BB", fc, cnt * 2) + struct.pack(">" + "H" * cnt, *vals))
                elif fc == 2:
                    start, cnt = struct.unpack(">HH", body[1:5])
                    nb = (cnt + 7) // 8; buf = bytearray(nb)
                    for i in range(cnt):
                        if bits.get(start + i): buf[i // 8] |= (1 << (i % 8))
                    reply(struct.pack(">BB", fc, nb) + bytes(buf))
                elif fc == 6:
                    addr, val = struct.unpack(">HH", body[1:5])
                    words["hold"][addr] = (lambda v: (lambda t2: v))(val)  # FC06 writes holding only
                    reply(body[:5])
                else:
                    reply(struct.pack(">BB", fc | 0x80, 2))
        finally:
            conn.close()
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port)); srv.listen(8)
    def loop():
        while True:
            c, _ = srv.accept()
            threading.Thread(target=handle, args=(c,), daemon=True).start()
    threading.Thread(target=loop, daemon=True).start()
    print(f"  demo dev : GENERIC emulator for template '{template['id']}' on 127.0.0.1:{port}")

def start_demo_device(port):
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port)); srv.listen(8)
    def loop():
        while True:
            c, _ = srv.accept()
            threading.Thread(target=_demo_conn, args=(c,), daemon=True).start()
    threading.Thread(target=loop, daemon=True).start()
    print(f"  demo CDU : Modbus TCP XDU1350B emulator on 127.0.0.1:{port} (FC02/03/04/06)")

# ---------------- app window (Edge/Chrome --app: one window, no browser chrome) ----------------
def open_app_window(url):
    import subprocess, webbrowser
    cands = []
    if os.name == "nt":
        pf = os.environ.get("PROGRAMFILES", r"C:\Program Files")
        pf86 = os.environ.get("PROGRAMFILES(X86)", pf)
        local = os.environ.get("LOCALAPPDATA", "")
        for base in (pf, pf86, local):
            cands += [os.path.join(base, r"Microsoft\Edge\Application\msedge.exe"),
                      os.path.join(base, r"Google\Chrome\Application\chrome.exe")]
    elif sys.platform == "darwin":
        cands = ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    else:
        cands = ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome"]
    for c in cands:
        if os.path.exists(c):
            try:
                subprocess.Popen([c, f"--app={url}", "--window-size=1600,950",
                                  "--user-data-dir=" + os.path.join(HERE, ".w1window")],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return True
            except Exception:
                pass
    webbrowser.open(url)  # last resort: default browser tab
    return False

def resolve_ui():
    for c in (os.path.join(HERE, "WitnessONE.html"),
              os.path.join(BUNDLE, "WitnessONE.html"),
              os.path.join(HERE, "..", "dist", "WitnessONE.html"),
              os.path.join(HERE, "dist", "WitnessONE.html")):
        if os.path.exists(c): return os.path.abspath(c)
    return None

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5710)
    ap.add_argument("--probe", default=None, metavar="HOST[:PORT]",
                    help="one-shot field check: read one Modbus register and exit (use with --unit/--addr)")
    ap.add_argument("--addr", type=int, default=30001, help="SPL address for --probe (default 30001)")
    ap.add_argument("--unit", type=int, default=1, help="unit id for --probe")
    ap.add_argument("--topserver", default=None, help="TOP Server Configuration API base URL (proxied at /proxy/config)")
    ap.add_argument("--iot", default=None, help="IoT Gateway REST base URL (proxied at /proxy/iot)")
    ap.add_argument("--remote", default=None, help="central registry DB API base URL (pull/push/verify)")
    ap.add_argument("--insecure-tls", action="store_true",
                    help="disable TLS certificate verification for --topserver/--iot/--remote "
                         "(ONLY for known self-signed lab servers; unsafe on shared networks)")
    ap.add_argument("--ui", default=None, help="path to WitnessONE.html (auto-resolved if omitted)")
    ap.add_argument("--headless", action="store_true", help="don't open the app window")
    ap.add_argument("--demo-device", action="store_true", help="start the built-in XDU1350B Modbus emulator")
    ap.add_argument("--demo-template", default=None, help="emulate ANY device template id (generic values) on --demo-port")
    ap.add_argument("--demo-port", type=int, default=1502)
    ARGS = ap.parse_args()
    if ARGS.probe:
        host, _, prt = ARGS.probe.partition(":")
        prt = int(prt or 502)
        kind, off = addr_split(ARGS.addr)
        print(f"PROBE {host}:{prt} unit {ARGS.unit} — {ARGS.addr} ({kind} offset {off}) ...")
        t0 = time.time()
        try:
            m = Modbus(host, prt, ARGS.unit, timeout=3.0); m.connect()
            try:
                if kind in ("input", "hold"):
                    v = m.read_words(4 if kind == "input" else 3, off, 1)[0]
                else:
                    v = m.read_bits(2 if kind == "disc" else 1, off, 1)[0]
            finally:
                m.close()
            print(f"OK    {ARGS.addr} = {v}   ({int((time.time()-t0)*1000)} ms · real Modbus TCP)")
            sys.exit(0)
        except Exception as e:
            print(f"FAIL  {e}")
            print("      checklist: device powered? IP reachable (ping)? port 502 open? unit id right? firewall?")
            sys.exit(1)
    UI_PATH = os.path.abspath(ARGS.ui) if ARGS.ui else resolve_ui()
    url = f"http://127.0.0.1:{ARGS.port}"
    print(f"WitnessONE v{VERSION} · {url}")
    print(f"  templates: {tpl_dir()} ({len(load_templates())})")
    for _t in load_templates():
        for _w in validate_point_fcs(_t):
            print("  ! FC mismatch (SPL declares one table, address implies another):", _w)
    print(f"  records  : {DB_PATH}")
    print(f"  remote registry: {ARGS.remote or '— (verify/propose queue locally)'}")
    print(f"  UI       : {'serving ' + UI_PATH if UI_PATH and os.path.exists(UI_PATH) else 'not found (API only)'}")
    if ARGS.demo_template:
        _t = next((t for t in load_templates() if t["id"] == ARGS.demo_template), None)
        if _t: start_template_device(ARGS.demo_port, _t)
        else: print(f"  ! unknown --demo-template '{ARGS.demo_template}'")
    elif ARGS.demo_device:
        start_demo_device(ARGS.demo_port)
    srv = ThreadingHTTPServer(("127.0.0.1", ARGS.port), H)
    if not ARGS.headless and UI_PATH:
        threading.Thread(target=lambda: (time.sleep(0.6), open_app_window(url)), daemon=True).start()
        print("  window   : opening app window (Edge/Chrome --app)…")
    srv.serve_forever()
