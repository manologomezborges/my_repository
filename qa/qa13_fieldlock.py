"""FIELD LOCK acceptance — the security air-gap. While the laptop is connected to
a device the Agent MUST refuse every external egress path (central registry via
remote_call, TOP Server/IoT via /proxy/*) BEFORE opening a socket, and must
release cleanly when the operator leaves the asset. Pure HTTP; starts the Agent
with a (deliberately unreachable) --remote and --topserver so both egress paths
exist, and a Modbus emulator to trip the auto-lock.  MG"""
import subprocess, sys, os, time, socket, json, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEVICE_SIM = os.path.join(HERE, 'modbus_device_sim.py')
AGENT_SCRIPT = os.path.join(ROOT, 'agent', 'witnessone_agent.py')
DEVICE_PORT, AGENT_PORT = 1502, 5716
BASE = f'http://127.0.0.1:{AGENT_PORT}'
UNREACHABLE = 'http://10.255.255.1'          # RFC5737-ish black hole so egress would hang if not blocked
failures = []

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(name + (f' ({detail})' if detail else ''))

def call(path, method='GET', body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={'Content-Type': 'application/json', 'Origin': 'null'})
    try:
        r = urllib.request.urlopen(req, timeout=6); return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {}

def wait_http(url, t=12.0):
    d = time.time() + t
    while time.time() < d:
        try: urllib.request.urlopen(url, timeout=1.0); return True
        except Exception: time.sleep(0.15)
    return False

def wait_port(host, port, t=10.0):
    d = time.time() + t
    while time.time() < d:
        try:
            with socket.create_connection((host, port), 0.3): return True
        except OSError: time.sleep(0.1)
    return False

dev = subprocess.Popen([sys.executable, DEVICE_SIM, '--port', str(DEVICE_PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ag = subprocess.Popen([sys.executable, AGENT_SCRIPT, '--headless', '--port', str(AGENT_PORT),
                       '--remote', UNREACHABLE, '--topserver', UNREACHABLE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    if not wait_port('127.0.0.1', DEVICE_PORT) or not wait_http(BASE + '/agent/status'):
        print('FIXTURE TIMEOUT'); sys.exit(1)

    st = call('/agent/status')[1]
    check('starts unlocked in PREP phase', st.get('phase') == 'prep' and st.get('fieldLock') is False, str(st.get('phase')))

    # touching the device must auto-engage the lock
    check('modbus probe accepted', call('/modbus/probe', 'POST', {'ip': '127.0.0.1', 'port': DEVICE_PORT, 'unit': 1, 'addr': 30001})[0] == 200)
    st = call('/agent/status')[1]
    check('device op auto-engaged the FIELD LOCK', st.get('phase') == 'field' and st.get('fieldLock') is True, str(st.get('phase')))

    # every external egress path must refuse while locked, fast (not hang on the black hole)
    t0 = time.time(); code, jp = call('/proxy/config/v1/about')
    check('TOP Server proxy blocked (HTTP 423) while locked', code == 423, f'HTTP {code}')
    check('proxy refused WITHOUT opening a socket (fast, no black-hole hang)', (time.time() - t0) < 3.0, f'{time.time()-t0:.1f}s')
    sync = call('/registry/sync', 'POST', {})[1]
    check('registry sync blocked while locked', sync.get('ok') is False and 'FIELD LOCK' in str(sync.get('msg') or sync.get('error') or ''), str(sync)[:70])

    # localhost records archive must STILL work while locked (it is not external)
    rec = call('/records/runs', 'POST', {'overall': 'PASS', 'meta': {'Make': 'V', 'Model': 'X'}, 'dataSource': 'LIVE'})
    check('local records archive still works under lock', rec[0] == 201 and rec[1].get('ok') is True)

    # leaving the asset releases the lock and re-enables egress
    rel = call('/agent/phase', 'POST', {'phase': 'prep'})[1]
    check('phase prep releases the lock', rel.get('fieldLock') is False and rel.get('phase') == 'prep')
    code2 = call('/proxy/config/v1/about')[0]
    check('proxy no longer FIELD-LOCK-blocked after release', code2 != 423, f'HTTP {code2}')
finally:
    for p in (dev, ag):
        try: p.terminate(); p.wait(timeout=5)
        except Exception:
            try: p.kill()
            except Exception: pass

if failures:
    print('\nFAIL:', len(failures), 'check(s):'); [print('  -', f) for f in failures]; sys.exit(1)
print('\nPASS: qa13 field-lock ok — external registry/proxy egress is blocked before any socket opens while connected to a device, and released on leaving')
