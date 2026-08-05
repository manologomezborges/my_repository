import asyncio, subprocess, time, json, sys, os, socket, urllib.request, urllib.error
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'file://' + os.path.join(ROOT, 'dist', 'WitnessONE.html')
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
DEVICE_SIM = os.path.join(HERE, 'modbus_device_sim.py')
AGENT_SCRIPT = os.path.join(ROOT, 'agent', 'witnessone_agent.py')
DEVICE_PORT = 1502
AGENT_PORT = 5710
AGENT = f'http://127.0.0.1:{AGENT_PORT}'
DEV_STDERR = OUT + 'qa4_device_stderr.log'
AGENT_STDERR = OUT + 'qa4_agent_stderr.log'
errors=[]
failures=[]

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(f'{name}' + (f' ({detail})' if detail else ''))

def get(path):
    return json.loads(urllib.request.urlopen(AGENT+path,timeout=6).read())

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

def assert_alive(proc, name, log_path):
    if proc.poll() is not None:
        print(f'FIXTURE DIED: {name} exited with code {proc.returncode}')
        print('--- stderr tail ---')
        print(tail(log_path))
        sys.exit(1)

async def main():
    dev_err = open(DEV_STDERR, 'wb')
    agent_err = open(AGENT_STDERR, 'wb')
    dev=subprocess.Popen([sys.executable, DEVICE_SIM, '--port', str(DEVICE_PORT)],
                         stdout=subprocess.DEVNULL, stderr=dev_err)
    ag=subprocess.Popen([sys.executable, AGENT_SCRIPT, '--headless', '--port', str(AGENT_PORT)],
                        stdout=subprocess.DEVNULL, stderr=agent_err)
    dev_ready = wait_for_port('127.0.0.1', DEVICE_PORT, timeout=10.0)
    assert_alive(dev, 'modbus device sim', DEV_STDERR)
    if not dev_ready:
        print('FIXTURE TIMEOUT: device sim never opened port', DEVICE_PORT); dev.terminate(); ag.terminate(); sys.exit(1)
    agent_ready = wait_for_http(AGENT+'/agent/status', timeout=12.0)
    assert_alive(ag, 'witnessone agent', AGENT_STDERR)
    if not agent_ready:
        print('FIXTURE TIMEOUT: agent never answered /agent/status'); dev.terminate(); ag.terminate(); sys.exit(1)
    try:
        print('AGENT STATUS:',get('/agent/status'))
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(str(e)))
            pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(URL); await pg.wait_for_timeout(1800)
            chip=await pg.text_content('#agentChip'); print('AGENT CHIP:',chip.strip())
            # library modal + verify
            await pg.click('#btnLibrary'); await pg.wait_for_timeout(900)
            await pg.screenshot(path=OUT+'40_library.png')
            await pg.click('[data-v="vertiv-xdu1350b-cdu"]'); await pg.wait_for_timeout(1200)
            lib=await pg.text_content('#libList'); print('VERIFIED TODAY IN LIB:', time.strftime('%Y-%m-%d') in lib)
            check('VERIFIED TODAY IN LIBRARY', time.strftime('%Y-%m-%d') in lib)
            await pg.click('#btnLibClose')
            # real discovery against the Modbus device sim
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port',str(DEVICE_PORT))
            await pg.click('#btnDiscover'); await pg.wait_for_timeout(2500)
            # NOTE: the match verdict is set on #discChipTxt ("REGISTER MAP MATCHES
            # TEMPLATE …"), not in #discLines (whose "map consistent with VERTIV…"
            # text never contains the literal word MATCH) — see src/app/10_boot.js
            # showMatch()/realDiscovery().
            chipTxt=await pg.text_content('#discChipTxt')
            disc=await pg.text_content('#discLines')
            discovery_match = 'MATCH' in chipTxt.upper() and 'VERTIV' in disc.upper()
            print('REAL DISCOVERY MATCH:', discovery_match, '|', chipTxt.strip())
            check('REAL DISCOVERY MATCH', discovery_match, f'chip={chipTxt.strip()!r}')
            await pg.screenshot(path=OUT+'41_real_discovery.png')
            await pg.click('#btnDiscAdopt'); await pg.wait_for_timeout(400)
            # LIVE direct-only (no TOP Server running -> config offline path)
            await pg.click('#segLive')  # default link = DIRECT MODBUS
            await pg.click('#btnConnect'); await pg.wait_for_timeout(4500)
            await pg.screenshot(path=OUT+'42_handshake_direct.png')
            hs=await pg.text_content('#hsLines')
            # NOTE: current UI copy (src/app/10_boot.js hsLine calls) prints the
            # `--direct-modbus` link command and "FULL LIVE telemetry" once real
            # block-reads succeed; the old "DIRECT-ONLY"/"Direct Modbus via Agent"
            # strings this suite used to grep for do not appear anywhere in hsLines.
            direct_cmd = '--direct-modbus' in hs
            full_live = 'FULL LIVE telemetry' in hs
            print('DIRECT-ONLY PATH: direct cmd', direct_cmd, '| full live:', full_live)
            check('DIRECT-ONLY PATH (handshake shows --direct-modbus)', direct_cmd, hs.strip()[:200])
            check('DIRECT-ONLY PATH (FULL LIVE telemetry reached)', full_live, hs.strip()[:200])
            await pg.wait_for_timeout(6500)
            chip2=await pg.text_content('#simChipIn'); print('SOURCE CHIP:',chip2.strip())
            v08=await pg.text_content('#pv_P08'); v02=await pg.text_content('#pv_P02')
            print('LIVE P08/P02:',v08.strip(),'|',v02.strip())
            await pg.screenshot(path=OUT+'43_dash_direct.png')
            # live write through agent -> real FC06 to the device sim.
            # Writes are SAFE-gated (src/app/07_ui.js): #spApply short-circuits
            # with a toast unless #btnArmWrites is clicked first, so the write
            # must be armed here or the readback below proves nothing (QA-5).
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench'); await pg.wait_for_timeout(400)
            before = get('/modbus/read?template=vertiv-xdu1350b-cdu&ip=127.0.0.1&port='+str(DEVICE_PORT)+'&unit=1')
            sp_before = before['values'].get('40001')
            await pg.click('#btnArmWrites'); await pg.wait_for_timeout(300)
            safe=await pg.text_content('#safeChip'); print('ARMED CHIP:', safe.strip())
            await pg.eval_on_selector('#spSlider','e=>{e.value=30;e.dispatchEvent(new Event("input"))}')
            await pg.click('#spApply'); await pg.wait_for_timeout(1600)
            rd=get('/modbus/read?template=vertiv-xdu1350b-cdu&ip=127.0.0.1&port='+str(DEVICE_PORT)+'&unit=1')
            sp_after = rd['values'].get('40001')
            print('DEVICE 40001 BEFORE/AFTER WRITE:', sp_before, '->', sp_after)
            check('FC06 WRITE LANDED ON DEVICE (armed)', sp_after == 300, f'got {sp_after}, expected 300 (before was {sp_before})')
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')
            assert_alive(dev, 'modbus device sim (mid-run)', DEV_STDERR)
            assert_alive(ag, 'witnessone agent (mid-run)', AGENT_STDERR)
            # run the witness test at x16 and verify record archived
            await pg.click('#btnTest'); await pg.wait_for_timeout(600)
            await pg.click('#tdSpeedChip'); await pg.click('#tdSpeedChip')  # x16
            await pg.click('#btnTdRun')
            for _ in range(70):
                if await pg.eval_on_selector('#btnTdReport','b=>!b.disabled'): break
                await pg.wait_for_timeout(2000)
            counts=await pg.text_content('#tdCounts'); print('TEST COUNTS:',counts.strip())
            runs=get('/records/runs'); print('AGENT RECORDS:',len(runs['runs']),runs['runs'][:1])
            check('RECORD ARCHIVED AFTER RUN', len(runs['runs']) > 0)
            await pg.click('#btnTdReport'); await pg.wait_for_timeout(1200)
            body=await pg.text_content('#reportScroll')
            cert_live = 'Direct Modbus via WitnessONE Agent' in body
            print('CERT DATA SOURCE LIVE:', cert_live)
            check('CERTIFICATE SHOWS LIVE DATA SOURCE', cert_live)
            await pg.screenshot(path=OUT+'44_cert_live.png')
            await b.close()
    finally:
        for proc in (dev, ag):
            proc.terminate()
        for proc in (dev, ag):
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill()
        dev_err.close(); agent_err.close()
    print('PAGEERRORS:',errors if errors else 'none')
    if failures:
        print('FAIL:', len(failures), 'check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print('PASS: qa4 ok')

asyncio.run(main())
