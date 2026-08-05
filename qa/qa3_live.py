import asyncio, subprocess, time, json, urllib.request, urllib.error, urllib.parse, base64, sys, os, socket
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'file://' + os.path.join(ROOT, 'dist', 'WitnessONE.html')
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
MOCK_SCRIPT = os.path.join(ROOT, 'dist', 'witnessone_mock_topserver.py')
MOCK_PORT = 57418
API = f'http://127.0.0.1:{MOCK_PORT}'
AUTH = 'Basic '+base64.b64encode(b'Administrator:witness').decode()
STDERR_LOG = OUT + 'qa3_mock_stderr.log'
errors=[]
failures=[]

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(f'{name}' + (f' ({detail})' if detail else ''))

def api_get(path):
    rq=urllib.request.Request(API+path); rq.add_header('Authorization',AUTH)
    return json.loads(urllib.request.urlopen(rq,timeout=5).read())

def wait_for_port(host, port, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.3):
                return True
        except OSError:
            time.sleep(0.1)
    return False

def stderr_tail():
    try:
        return open(STDERR_LOG, errors='replace').read()[-3000:]
    except OSError:
        return '(no stderr captured)'

def assert_alive(proc, name):
    if proc.poll() is not None:
        print(f'FIXTURE DIED: {name} exited with code {proc.returncode}')
        print('--- stderr tail ---')
        print(stderr_tail())
        sys.exit(1)

async def main():
    stderr_f = open(STDERR_LOG, 'wb')
    mock=subprocess.Popen([sys.executable, MOCK_SCRIPT, '--port', str(MOCK_PORT)],
                          stdout=subprocess.DEVNULL, stderr=stderr_f)
    if not wait_for_port('127.0.0.1', MOCK_PORT, timeout=10.0):
        assert_alive(mock, 'mock topserver')
        print('FIXTURE TIMEOUT: mock topserver never opened port', MOCK_PORT)
        mock.terminate(); sys.exit(1)
    assert_alive(mock, 'mock topserver')
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
            pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(URL); await pg.wait_for_timeout(1000)
            # LIVE mode setup
            await pg.click('#segLive')
            await pg.click('#lvTops')
            await pg.fill('#apiPass','witness')
            await pg.fill('#iotUrl',API)
            await pg.click('#btnApiTest'); await pg.wait_for_timeout(1500)
            st=await pg.text_content('#apiStatus'); print('TEST API:',st.strip())
            check('API TEST OK', st.strip().startswith('✔'), st.strip())
            # explorer shows seeded project
            await pg.click('#btnExplore'); await pg.wait_for_timeout(1500)
            tree=await pg.text_content('#explTree'); print('EXPLORER:', 'CH_PLANT' in tree and 'AHU_07' in tree)
            check('EXPLORER SHOWS SEEDED PROJECT', 'CH_PLANT' in tree and 'AHU_07' in tree)
            await pg.screenshot(path=OUT+'30_explorer.png')
            await pg.click('#btnExplOk'); await pg.wait_for_timeout(400)
            # connect live
            await pg.click('#btnConnect'); await pg.wait_for_timeout(4000)
            await pg.screenshot(path=OUT+'31_handshake_live.png')
            await pg.wait_for_timeout(7000)
            await pg.screenshot(path=OUT+'32_dash_live.png')
            chip=await pg.text_content('#simChipIn'); print('CHIP:',chip.strip())
            v02=await pg.text_content('#pv_P02'); print('P02 LIVE VALUE:',v02.strip())
            v08=await pg.text_content('#pv_P08'); print('P08 LIVE VALUE:',v08.strip())
            # verify provisioning landed on mock
            tags=api_get('/config/v1/project/channels/CH_FWT01/devices/CDU_01/tags')
            print('MOCK TAGS CREATED:',len(tags))
            check('MOCK TAGS CREATED', len(tags) > 0, f'count={len(tags)}')
            # live write via bench
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench'); await pg.wait_for_timeout(400)
            await pg.click('#btnArmWrites'); await pg.wait_for_timeout(300)   # arm writes (SAFE gate)
            await pg.eval_on_selector('#spSlider','e=>{e.value=30;e.dispatchEvent(new Event("input"))}')
            await pg.click('#spApply'); await pg.wait_for_timeout(1500)
            rd=json.loads(urllib.request.urlopen(API+'/iotgateway/read?ids='+
                urllib.parse.quote('CH_FWT01.CDU_01.P04_Secondary_Temperature_Setpoint_P301'),timeout=5).read())
            sp_after = rd['readResults'][0]['v']
            print('MOCK SP AFTER WRITE (raw):', sp_after)
            check('LIVE FC06-EQUIVALENT WRITE LANDED ON MOCK', sp_after == 300, f'got {sp_after}, expected 300')
            await pg.screenshot(path=OUT+'33_live_write.png')
            await b.close()
            assert_alive(mock, 'mock topserver (mid-run)')
            # failure path: bad port -> doctor
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            await pg.goto(URL); await pg.wait_for_timeout(900)
            await pg.click('#segLive')
            await pg.click('#lvTops')
            await pg.fill('#apiUrl','http://127.0.0.1:59999')
            await pg.click('#btnApiTest'); await pg.wait_for_timeout(8000)
            doc=await pg.is_visible('#doctorModal'); print('DOCTOR SHOWN:',doc)
            check('DOCTOR MODAL SHOWN ON UNREACHABLE API', doc)
            await pg.screenshot(path=OUT+'34_doctor.png')
            await pg.click('#btnDocSim'); await pg.wait_for_timeout(500)
            boot=await pg.is_visible('#bootCard'); print('BACK TO BOOT SIM:',boot)
            check('BACK TO BOOT SIM AFTER DOCTOR', boot)
            await b.close()
    finally:
        mock.terminate()
        try: mock.wait(timeout=5)
        except subprocess.TimeoutExpired: mock.kill()
        stderr_f.close()
    print('PAGEERRORS:',errors if errors else 'none')
    if failures:
        print('FAIL:', len(failures), 'check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print('PASS: qa3 ok')

asyncio.run(main())
