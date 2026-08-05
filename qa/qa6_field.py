import asyncio, subprocess, time, json, sys, os, glob, socket, urllib.request, urllib.error
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
AGENT_SCRIPT = os.path.join(ROOT, 'agent', 'witnessone_agent.py')
AGENT_PORT = 5710
APP = f'http://127.0.0.1:{AGENT_PORT}'
STDERR_LOG = OUT + 'qa6_agent_stderr.log'
errors=[]
failures=[]

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(f'{name}' + (f' ({detail})' if detail else ''))

def get(p): return json.loads(urllib.request.urlopen(APP+p,timeout=6).read())
def post(p,b):
    rq=urllib.request.Request(APP+p,data=json.dumps(b).encode(),headers={'Content-Type':'application/json'})
    return json.loads(urllib.request.urlopen(rq,timeout=20).read())

def wait_for_http(url, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1.0)
            return True
        except Exception:
            time.sleep(0.15)
    return False

def tail(path):
    try:
        return open(path, errors='replace').read()[-3000:]
    except OSError:
        return '(no stderr captured)'

def assert_alive(proc, name):
    if proc.poll() is not None:
        print(f'FIXTURE DIED: {name} exited with code {proc.returncode}')
        print('--- stderr tail ---')
        print(tail(STDERR_LOG))
        sys.exit(1)

async def main():
    stderr_f = open(STDERR_LOG, 'wb')
    app=subprocess.Popen([sys.executable, AGENT_SCRIPT,
                          '--headless','--demo-device','--port',str(AGENT_PORT)],
                          stdout=subprocess.DEVNULL, stderr=stderr_f)
    agent_ready = wait_for_http(APP+'/agent/status', timeout=12.0)
    assert_alive(app, 'witnessone agent (--demo-device)')
    if not agent_ready:
        print('FIXTURE TIMEOUT: agent never answered /agent/status'); app.terminate(); sys.exit(1)
    try:
        # --- agent register sweep directly ---
        sc=post('/modbus/scan',{'ip':'127.0.0.1','port':1502,'unit':1})
        addrs=[f['addr'] for f in sc['found']]
        print('SWEEP found',len(addrs),'regs · has 30021(NEW):',30021 in addrs,'· probed',sc['probed'])
        check('SWEEP FOUND THE NEW 30021 REGISTER', 30021 in addrs)
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(str(e)))
            pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(APP+'/'); await pg.wait_for_timeout(1600)
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port','1502')
            # register-range sweep in UI
            await pg.click('#btnDiscover'); await pg.wait_for_timeout(4000)
            disc=await pg.text_content('#discLines')
            ui_sweep_flagged = '30021' in disc and 'NOT in the SPL' in disc
            ui_overlay = 'SPL registers responding' in disc
            print('UI SWEEP: NEW 30021 flagged:', ui_sweep_flagged, '| responding overlay:', ui_overlay)
            check('UI SWEEP FLAGS NEW 30021 REGISTER', ui_sweep_flagged)
            check('UI SWEEP SHOWS RESPONDING OVERLAY', ui_overlay)
            await pg.screenshot(path=OUT+'60_register_sweep.png')
            await pg.click('#btnDiscClose')
            # connect LIVE direct
            await pg.click('#segLive')  # default link = DIRECT MODBUS
            await pg.click('#btnConnect'); await pg.wait_for_timeout(9000)
            safeVisible = await pg.is_visible('#safeChip')
            safeText = (await pg.text_content('#safeChip')).strip()
            print('SAFE CHIP visible:', safeVisible, '| text:', safeText)
            check('SAFE CHIP VISIBLE ON CONNECT', safeVisible)
            check('SAFE CHIP STARTS READ-ONLY (writes disarmed by default)', 'READ-ONLY' in safeText, safeText)
            assert_alive(app, 'witnessone agent (mid-run)')
            # write blocked while SAFE
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench'); await pg.wait_for_timeout(400)
            before=post('/modbus/scan',{'ip':'127.0.0.1','port':1502,'unit':1,'ranges':[{'fc':3,'start':0,'count':1}]})
            sp_before=[f for f in before['found'] if f['addr']==40001]
            sp_before_val = sp_before[0]['value'] if sp_before else None
            await pg.eval_on_selector('#spSlider','e=>{e.value=30;e.dispatchEvent(new Event("input"))}')
            await pg.click('#spApply'); await pg.wait_for_timeout(800)
            after_safe=post('/modbus/scan',{'ip':'127.0.0.1','port':1502,'unit':1,'ranges':[{'fc':3,'start':0,'count':1}]})
            sp_after_safe=[f for f in after_safe['found'] if f['addr']==40001]
            sp_after_safe_val = sp_after_safe[0]['value'] if sp_after_safe else None
            print('SAFE blocked write — device 40001 before:', sp_before_val, '| after apply-while-safe:', sp_after_safe_val)
            check('SAFE MODE BLOCKS THE WRITE (value unchanged while disarmed)', sp_after_safe_val == sp_before_val,
                  f'before={sp_before_val} after={sp_after_safe_val}')
            # arm + witnessed setpoint test W06
            await pg.click('#btnArmWrites'); await pg.wait_for_timeout(300)
            armedText=(await pg.text_content('#safeChip')).strip()
            print('ARMED chip:', armedText)
            check('SAFE CHIP SHOWS WRITES ARMED', 'ARMED' in armedText.upper(), armedText)
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')  # close
            # open deck, witnessed mode
            await pg.click('#btnTest'); await pg.wait_for_timeout(500)
            await pg.click('#tdModeWit'); await pg.wait_for_timeout(600)
            await pg.screenshot(path=OUT+'61_witnessed_deck.png')
            # arm W06 setpoint step
            await pg.eval_on_selector_all('#twb_W06 button','bs=>bs[0].click()')
            await pg.wait_for_timeout(1500)
            # simulate the FIELD action: vendor changes setpoint on the unit -> write via agent
            post('/modbus/write',{'ip':'127.0.0.1','port':1502,'unit':1,'addr':40001,'value':300})
            await pg.wait_for_timeout(3500)  # tool auto-detects trigger from real reads
            w06=await pg.text_content('#twt_W06')
            print('W06 timeline after field change:', w06.strip()[:80])
            check('W06 TIMELINE DETECTED THE FIELD SETPOINT CHANGE', bool(w06.strip()), w06.strip()[:120])
            # confirm event, watch recovery (T2 tracks to 30.0), then it auto-recovers
            btns=await pg.query_selector_all('#twb_W06 button')
            # phase should be triggered -> click "Event OK"
            await pg.eval_on_selector_all('#twb_W06 button','bs=>{for(const b of bs){if(/Event OK/.test(b.textContent)){b.click();return}}}')
            await pg.wait_for_timeout(8000)  # let T2 converge to SP in the demo device
            await pg.eval_on_selector_all('#twb_W06 button','bs=>{for(const b of bs){if(/PASS/.test(b.textContent)){b.click();return}}}')
            await pg.wait_for_timeout(1200)
            cls=await pg.get_attribute('#tw_W06','class')
            w06_pass = 'pass' in (cls or '')
            print('W06 final class:', cls, '| PASS:', w06_pass)
            check('W06 WITNESSED TEST REACHED PASS', w06_pass, cls)
            await pg.screenshot(path=OUT+'62_witnessed_pass.png')
            # certificate carries witnessed section
            await pg.click('#btnTdReport'); await pg.wait_for_timeout(1200)
            body=await pg.text_content('#reportScroll')
            cert_witnessed = 'Witnessed field tests' in body
            cert_w06_row = 'Setpoint change response' in body
            print('CERT witnessed section:', cert_witnessed, '| W06 row:', cert_w06_row)
            check('CERTIFICATE HAS WITNESSED FIELD TESTS SECTION', cert_witnessed)
            check('CERTIFICATE HAS W06 ROW', cert_w06_row)
            await pg.screenshot(path=OUT+'63_cert_witnessed.png')
            runs=get('/records/runs'); print('RECORDS:',len(runs['runs']))
            check('RECORD ARCHIVED AFTER RUN', len(runs['runs']) > 0)
            await b.close()
    finally:
        app.terminate()
        try: app.wait(timeout=5)
        except subprocess.TimeoutExpired: app.kill()
        stderr_f.close()
    print('PAGEERRORS:',errors if errors else 'none')
    if failures:
        print('FAIL:', len(failures), 'check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print('PASS: qa6 ok')

asyncio.run(main())
