"""Field "Read as…" reinterpretation acceptance — a point's datatype can be
flipped live (int/float/bool + word order), it re-decodes from the last raw
words, and the edit forks a field-draft (approved revision untouched, AD-5).
Path-independent; starts its own agent + Modbus emulator.  MG"""
import asyncio, subprocess, time, sys, os, socket, urllib.request
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'file://' + os.path.join(ROOT, 'dist', 'WitnessONE.html')
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
DEVICE_SIM = os.path.join(HERE, 'modbus_device_sim.py')
AGENT_SCRIPT = os.path.join(ROOT, 'agent', 'witnessone_agent.py')
DEVICE_PORT, AGENT_PORT = 1502, 5710
AGENT = f'http://127.0.0.1:{AGENT_PORT}'
failures = []

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(name + (f' ({detail})' if detail else ''))

def wait_for_port(host, port, t=10.0):
    d = time.time() + t
    while time.time() < d:
        try:
            with socket.create_connection((host, port), 0.3): return True
        except OSError: time.sleep(0.1)
    return False

def wait_for_http(url, t=12.0):
    d = time.time() + t
    while time.time() < d:
        try: urllib.request.urlopen(url, timeout=1.0); return True
        except Exception: time.sleep(0.15)
    return False

async def main():
    dev = subprocess.Popen([sys.executable, DEVICE_SIM, '--port', str(DEVICE_PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ag = subprocess.Popen([sys.executable, AGENT_SCRIPT, '--headless', '--port', str(AGENT_PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_for_port('127.0.0.1', DEVICE_PORT) or not wait_for_http(AGENT + '/agent/status'):
        print('FIXTURE TIMEOUT'); dev.terminate(); ag.terminate(); sys.exit(1)
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch()
            pg = await b.new_page(viewport={'width': 1600, 'height': 950})
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(1800)
            await pg.fill('#ip', '127.0.0.1'); await pg.fill('#port', str(DEVICE_PORT))
            await pg.click('#btnDiscover'); await pg.wait_for_timeout(2600)
            await pg.click('#btnDiscAdopt'); await pg.wait_for_timeout(400)
            await pg.click('#segLive'); await pg.click('#btnConnect'); await pg.wait_for_timeout(9000)
            await pg.wait_for_timeout(2000)

            base = await pg.evaluate("""()=>{const p=SPL_DB.points.find(x=>x.id==='P08');
                return {rt:p.regType,span:!!p.span32,status:(W1_ACTIVE_TEMPLATE.registry.revStatus||'approved')};}""")
            check('starts on an approved revision', base['status'] == 'approved', base['status'])
            check('P08 starts as a 16-bit point', not base['span'], base['rt'])

            f32 = await pg.evaluate("""()=>{UI.setReadAs('P08','float32');const p=SPL_DB.points.find(x=>x.id==='P08');
                return {rt:p.regType,span:!!p.span32,status:(W1_ACTIVE_TEMPLATE.registry.revStatus||'approved'),
                        fc:LIVE.fcForAddr(p.addrs[0]),q:(SIM.read('P08').q||{}).txt};}""")
            check('Read-as float32 sets regType float32 + span32', f32['rt'] == 'float32' and f32['span'], f32['rt'])
            check('the edit forked a FIELD-DRAFT (approved untouched)', f32['status'] == 'field-draft', f32['status'])

            b16 = await pg.evaluate("""()=>{UI.setReadAs('P08','uint16');const p=SPL_DB.points.find(x=>x.id==='P08');
                return {rt:p.regType,span:!!p.span32,signed:p.signed,val:SIM.read('P08').txt};}""")
            check('Read-as uint16 returns to a single-register decode', (not b16['span']) and b16['signed'] == 'Unsigned', f"{b16['signed']}/{b16['span']}")
            check('uint16 re-decodes to a real value (not BAD)', b16['val'] not in ('—', None), b16['val'])

            wo = await pg.evaluate("""()=>{UI.setReadAs('P08','float32');UI.setWordOrder('P08','lohi');
                return SPL_DB.points.find(x=>x.id==='P08').wordOrder;}""")
            check('word-order swap persists on the point', wo == 'lohi', wo)

            # approved revision on disk must be unchanged (immutability held)
            approved = os.path.join(ROOT, 'pointslists', 'vertiv-xdu1350b-cdu', 'spl-1.0.json')
            import json
            ap = json.load(open(approved))
            p08 = next((p for p in ap['spl']['points'] if p['id'] == 'P08'), {})
            check('approved spl-1.0 P08 NOT mutated on disk', p08.get('regType', '16int') != 'float32', p08.get('regType'))

            check('no page errors', not errs, str(errs[:2]))
            await pg.screenshot(path=OUT + 'qa12_readas.png')
            await b.close()
    finally:
        for p in (dev, ag):
            try: p.terminate(); p.wait(timeout=5)
            except Exception:
                try: p.kill()
                except Exception: pass
    if failures:
        print('\nFAIL:', len(failures), 'check(s):');  [print('  -', f) for f in failures]; sys.exit(1)
    print('\nPASS: qa12 read-as ok — live datatype reinterpretation forks a field-draft and leaves the approved revision intact')

asyncio.run(main())
