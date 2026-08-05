import asyncio, subprocess, time, sys, os, socket, json, urllib.request, urllib.error
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
DEVICE_SIM = os.path.join(HERE, 'modbus_device_sim.py')
AGENT_SCRIPT = os.path.join(ROOT, 'agent', 'witnessone_agent.py')
DEVICE_PORT = 1502
AGENT_PORT = 5710
AGENT = f'http://127.0.0.1:{AGENT_PORT}'
DEV_STDERR = OUT + 'qa8_device_stderr.log'
AGENT_STDERR = OUT + 'qa8_agent_stderr.log'
errors=[]
failures=[]

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(f'{name}' + (f' ({detail})' if detail else ''))

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
        st=json.loads(urllib.request.urlopen(AGENT+'/agent/status',timeout=5).read())
        print('AGENT:',st.get('agent'),st.get('version'))
        check('AGENT STATUS REACHABLE', st.get('agent') == 'witnessone', str(st))
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
            await pg.goto(AGENT+'/'); await pg.wait_for_timeout(1200)
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port',str(DEVICE_PORT))
            await pg.click('#segLive'); await pg.wait_for_timeout(250)   # default = DIRECT MODBUS
            modbusDefault = await pg.is_visible('#lvModbusPane')
            print('modbus pane default:', modbusDefault)
            check('MODBUS PANE IS DEFAULT LIVE LINK', modbusDefault)
            await pg.click('#btnConnect'); await pg.wait_for_timeout(4500)
            hs=await pg.text_content('#hsLines')
            direct_cmd = '--direct-modbus' in hs
            full_live = 'FULL LIVE telemetry' in hs
            print('HS has direct-modbus cmd:', direct_cmd)
            print('HS FULL LIVE:', full_live)
            check('HANDSHAKE SHOWS --direct-modbus COMMAND', direct_cmd, hs.strip()[:200])
            check('HANDSHAKE REACHES FULL LIVE TELEMETRY', full_live, hs.strip()[:200])
            await pg.screenshot(path=OUT+'80_hs_direct.png')
            await pg.wait_for_timeout(6000)
            chip=await pg.text_content('#simChipIn'); print('CHIP:',chip.strip())
            rows=await pg.eval_on_selector_all('#ptRows tr','els=>els.length')
            rx=await pg.text_content('#rxChip'); print('ROWS:',rows,'| RX:',rx.strip())
            check('POINT TABLE HAS ROWS', rows > 0, f'rows={rows}')
            await pg.screenshot(path=OUT+'81_dash_direct.png')
            assert_alive(dev, 'modbus device sim (mid-run)', DEV_STDERR)
            assert_alive(ag, 'witnessone agent (mid-run)', AGENT_STDERR)
            await b.close()
    finally:
        for proc in (dev, ag):
            proc.terminate()
        for proc in (dev, ag):
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill()
        dev_err.close(); agent_err.close()
    print('PAGEERRORS:', errors if errors else 'none')
    if failures:
        print('FAIL:', len(failures), 'check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print('PASS: qa8 ok')
asyncio.run(main())
