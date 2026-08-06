"""v0.8.3 "Provenance Seal" acceptance suite — P0 issuance gate + staleness,
P1 provenance record, P2 tamper-evidence digest.  Path-independent; starts its
own fixtures (real Modbus emulator + agent) and cleans them up.  MG"""
import asyncio, subprocess, time, json, sys, os, socket, signal, sqlite3, urllib.request
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'file://' + os.path.join(ROOT, 'dist', 'WitnessONE.html')
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
DEVICE_SIM = os.path.join(HERE, 'modbus_device_sim.py')
AGENT_SCRIPT = os.path.join(ROOT, 'agent', 'witnessone_agent.py')
RECORDS_DB = os.path.join(ROOT, 'agent', 'witnessone_records.db')
DEVICE_PORT = 1502
AGENT_PORT = 5710
AGENT = f'http://127.0.0.1:{AGENT_PORT}'
DEV_STDERR = OUT + 'qa11_device_stderr.log'
AGENT_STDERR = OUT + 'qa11_agent_stderr.log'
failures = []

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(name + (f' ({detail})' if detail else ''))

def http_json(path, data=None, headers=None):
    h = {'Content-Type': 'application/json', 'Origin': 'null'}
    if headers: h.update(headers)
    req = urllib.request.Request(AGENT + path, data=(json.dumps(data).encode() if data is not None else None), headers=h)
    return json.loads(urllib.request.urlopen(req, timeout=6).read())

def wait_for_port(host, port, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.3):
                return True
        except OSError:
            time.sleep(0.1)
    return False

def wait_for_http(url, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1.0); return True
        except Exception:
            time.sleep(0.15)
    return False

def tail(path):
    try: return open(path, errors='replace').read()[-2000:]
    except OSError: return '(no stderr)'

async def adopt(pg):
    await pg.fill('#ip', '127.0.0.1'); await pg.fill('#port', str(DEVICE_PORT))
    await pg.click('#btnDiscover'); await pg.wait_for_timeout(2600)
    await pg.click('#btnDiscAdopt'); await pg.wait_for_timeout(400)

async def main():
    dev_err = open(DEV_STDERR, 'wb'); agent_err = open(AGENT_STDERR, 'wb')
    dev = subprocess.Popen([sys.executable, DEVICE_SIM, '--port', str(DEVICE_PORT)], stdout=subprocess.DEVNULL, stderr=dev_err)
    ag = subprocess.Popen([sys.executable, AGENT_SCRIPT, '--headless', '--port', str(AGENT_PORT)], stdout=subprocess.DEVNULL, stderr=agent_err)
    if not wait_for_port('127.0.0.1', DEVICE_PORT, 10.0):
        print('FIXTURE TIMEOUT: device sim'); dev.terminate(); ag.terminate(); sys.exit(1)
    if not wait_for_http(AGENT + '/agent/status', 12.0):
        print('FIXTURE TIMEOUT: agent', tail(AGENT_STDERR)); dev.terminate(); ag.terminate(); sys.exit(1)
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch()

            # ---- CASE 1 — P0 issuance gate on a SIMULATED session ----
            pg = await b.new_page(viewport={'width': 1600, 'height': 950})
            await pg.goto(URL); await pg.wait_for_timeout(1800)
            await adopt(pg)
            await pg.click('#segSim'); await pg.click('#btnConnect'); await pg.wait_for_timeout(6000)
            sim = await pg.evaluate("""async () => {
                FWT.results = FWT.baseResults(); await REPORT.open();
                const h = document.getElementById('reportScroll').innerHTML;
                return {ds:FWT.results.dataSource, wm:h.includes('SIMULATION DEMO'),
                        redtag:h.includes('RED TAG ✔'), demo:/DEMO —/.test(h),
                        commsNA:h.includes('no live session (simulated demonstration)'),
                        sid:FWT.results.sessionId};
            }""")
            await pg.screenshot(path=OUT + 'qa11_sim_cert.png')
            check('SIM cert is watermarked DEMONSTRATION', sim['wm'], sim['ds'])
            check('SIM cert carries NO RED TAG', not sim['redtag'])
            check('SIM verdict prefixed DEMO', sim['demo'])
            check('SIM section-2 comms is N/A', sim['commsNA'])
            check('SIM has no live session id', sim['sid'] is None)
            await pg.close()

            # ---- CASE 2 — P1 provenance + P2 digest on a LIVE session ----
            pg = await b.new_page(viewport={'width': 1600, 'height': 950})
            await pg.goto(URL); await pg.wait_for_timeout(1800)
            await adopt(pg)
            await pg.click('#segLive'); await pg.click('#btnConnect'); await pg.wait_for_timeout(9000)
            await pg.wait_for_timeout(2500)
            live = await pg.evaluate("""async () => {
                FWT.results = FWT.baseResults(); await REPORT.open();
                const h = document.getElementById('reportScroll').innerHTML; const R = FWT.results;
                return {live:!!(LIVE&&LIVE.valuesLive), ds:R.dataSource, sid:R.sessionId,
                        rid:R.agentRecordId, dig:R.digest, wm:h.includes('SIMULATION DEMO'),
                        redtag:h.includes('RED TAG ✔'), readat:h.includes('>Read at<'),
                        integ:h.includes('Integrity: SHA-256'),
                        pt:(R.p2p.find(x => x.ts) || {})};
            }""")
            await pg.screenshot(path=OUT + 'qa11_live_cert.png')
            check('LIVE session established', live['live'], live['ds'])
            check('LIVE cert NOT watermarked', not live['wm'])
            check('LIVE cert carries RED TAG', live['redtag'])
            check('session id minted (W1S-)', bool(live['sid']) and live['sid'].startswith('W1S-'), live['sid'])
            check('Read-at column present', live['readat'])
            check('per-point read time + fc present', bool(live['pt'].get('ts')) and bool(live['pt'].get('fc')), json.dumps(live['pt'])[:120])
            check('archived with agent record + digest', bool(live['rid']) and bool(live['dig']))
            check('integrity line printed', live['integ'])
            # P2: verify endpoint agrees on the untampered record
            v = http_json(f"/records/verify/{live['rid']}?digest={live['dig']}")
            check('verify: stored payload intact (match)', v.get('match') is True, json.dumps(v)[:120])
            check('verify: printed digest matches (externalMatch)', v.get('externalMatch') is True)

            # ---- CASE 3 — P0 staleness: kill the device mid-session ----
            os.kill(dev.pid, signal.SIGTERM)
            await pg.wait_for_timeout(9000)  # exceed staleMs + a few failed polls
            st = await pg.evaluate("""() => { const r = SIM.read('P08');
                return {q:r.q.txt, stale:!!r.stale, live:!!r.live, valuesLive:!!(LIVE&&LIVE.valuesLive), fc:LIVE.st.failCount};}""")
            check('stale point reads BAD (not simulated GOOD)', ('BAD' in st['q']) and not st['live'], st['q'])
            check('session STAYS live on link loss (no silent sim fallback)', st['valuesLive'] is True and st['fc'] >= 2)
            await pg.close()

            # ---- CASE 4 — P2 tamper detection via a direct DB edit ----
            rec = http_json('/records/runs', data={'overall': 'PASS', 'finishedAt': '2026-08-05T00:00:00Z',
                'meta': {'Make': 'VERTIV', 'Model': 'XDU1350B'}, 'dataSource': 'LIVE — Direct Modbus',
                'p2p': [{'id': 'P02', 'val': '5', 'res': 'PASS'}], 'sessionId': 'W1S-tamper'})
            rid = rec['id']
            v_ok = http_json(f'/records/verify/{rid}')
            check('fresh record verifies intact', v_ok.get('match') is True)
            check('external wrong digest rejected', http_json(f'/records/verify/{rid}?digest=deadbeef').get('externalMatch') is False)
            # tamper the stored payload behind the digest
            c = sqlite3.connect(RECORDS_DB)
            payload = json.loads(c.execute('SELECT payload FROM runs WHERE id=?', (rid,)).fetchone()[0])
            payload['p2p'][0]['val'] = '999'  # flip a certified value
            c.execute('UPDATE runs SET payload=? WHERE id=?', (json.dumps(payload), rid)); c.commit(); c.close()
            v_bad = http_json(f'/records/verify/{rid}')
            check('tampered payload FAILS verification', v_bad.get('match') is False, json.dumps(v_bad)[:120])

            await b.close()
    finally:
        for p in (dev, ag):
            try: p.terminate(); p.wait(timeout=5)
            except Exception:
                try: p.kill()
                except Exception: pass

    if failures:
        print('\nFAIL:', len(failures), 'check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print('\nPASS: qa11 provenance ok — issuance gate, provenance record, and tamper-evidence all hold')

asyncio.run(main())
