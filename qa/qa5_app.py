import asyncio, subprocess, time, json, sys, os, glob, socket, urllib.request, urllib.error, datetime
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
AGENT_SCRIPT = os.path.join(ROOT, 'agent', 'witnessone_agent.py')
AGENT_PORT = 5710
APP = f'http://127.0.0.1:{AGENT_PORT}'
PENDING_DIR = os.path.join(ROOT, 'agent', 'pending_commits')
STDERR_LOG = OUT + 'qa5_agent_stderr.log'
errors=[]
failures=[]

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(f'{name}' + (f' ({detail})' if detail else ''))

def get(path):
    return json.loads(urllib.request.urlopen(APP+path,timeout=6).read())

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
    # ONE process: agent + UI server + built-in demo CDU
    app=subprocess.Popen([sys.executable, AGENT_SCRIPT,
                          '--headless','--demo-device','--port',str(AGENT_PORT)],
                          stdout=subprocess.DEVNULL, stderr=stderr_f)
    agent_ready = wait_for_http(APP+'/agent/status', timeout=12.0)
    assert_alive(app, 'witnessone agent (--demo-device)')
    if not agent_ready:
        print('FIXTURE TIMEOUT: agent never answered /agent/status'); app.terminate(); sys.exit(1)
    try:
        print('STATUS:',get('/agent/status'))
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(str(e)))
            pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(APP+'/')            # UI served BY the app itself
            await pg.wait_for_timeout(1800)
            agentChip=(await pg.text_content('#agentChip')).strip()
            print('AGENT CHIP:', agentChip)
            # discovery against the built-in demo device
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port','1502')
            await pg.click('#btnDiscover'); await pg.wait_for_timeout(3500)
            chip=await pg.text_content('#discChipTxt'); adoptable=await pg.eval_on_selector('#btnDiscAdopt','b=>!b.disabled')
            discovery_match = adoptable and 'MATCH' in chip.upper()
            print('DISCOVERY MATCH:', discovery_match, '|', chip.strip()[:60])
            check('DISCOVERY MATCH', discovery_match, chip.strip()[:80])
            await pg.click('#btnDiscAdopt'); await pg.wait_for_timeout(300)
            # LIVE direct
            await pg.click('#segLive')  # default link = DIRECT MODBUS
            await pg.click('#btnConnect'); await pg.wait_for_timeout(9500)
            print('CHIP:',(await pg.text_content('#simChipIn')).strip())
            print('RX:',(await pg.text_content('#rxChip')).strip())
            assert_alive(app, 'witnessone agent (mid-run)')
            # baseline approved point count, read BEFORE the field-add so we can
            # prove the approved revision is untouched afterwards (QA-3/QA-1
            # immutability: field changes must fork a draft, never edit approved).
            base_tpl = get('/registry/devices')['templates'][0]
            base_n = len(base_tpl['spl']['points'])
            # field-add the NEW register the firmware exposes (30021 T2b) — not in SPL
            await pg.click('#btnAddReg'); await pg.wait_for_timeout(300)
            await pg.fill('#rgName','Secondary Supply Temperature T2b')
            await pg.fill('#rgAddr','30021'); await pg.fill('#rgGain','0.1')
            await pg.fill('#rgUnits','oC'); await pg.fill('#rgMin','-5'); await pg.fill('#rgMax','70')
            await pg.click('#btnRegAdd'); await pg.wait_for_timeout(2600)
            row=await pg.is_visible('#pr_C01'); v=await pg.text_content('#pv_C01')
            print('C01 ROW:',row,'| LIVE VALUE:',v.strip(),'(expect ~33.x = T2b over real Modbus)')
            check('C01 ROW VISIBLE AFTER FIELD ADD', row)
            print('RX AFTER ADD:',(await pg.text_content('#rxChip')).strip())
            await pg.screenshot(path=OUT+'50_field_added_register.png')
            # /registry/devices templates[0] reflects the APPROVED revision, which
            # the immutability guard (DATA-2/QA-1) keeps unchanged; the field point
            # lands in a separate field-draft revision (verified off disk below).
            tpl=get('/registry/devices')['templates'][0]
            n=len(tpl['spl']['points'])
            pend=glob.glob(os.path.join(PENDING_DIR,'*.json'))
            print('AGENT TEMPLATE POINTS:',n,'| PENDING COMMITS:',len(pend))
            check('APPROVED ACTIVE TEMPLATE UNCHANGED (immutable)', n == base_n, f'base={base_n} now={n}')
            check('COMMIT QUEUED ON AGENT', len(pend) > 0)
            if pend:
                pc=json.load(open(pend[-1]))
                print('COMMIT NOTE:',pc['note'],'| carries template:',bool(pc.get('template')))
            # read the draft revision straight off disk (not templates[0]) and prove
            # the approved spl-1.0.json still has its original point count.
            today = datetime.date.today().strftime('%Y%m%d')
            draft_path = os.path.join(ROOT,'pointslists','vertiv-xdu1350b-cdu',f'spl-1.0-fld-{today}.json')
            approved_path = os.path.join(ROOT,'pointslists','vertiv-xdu1350b-cdu','spl-1.0.json')
            if os.path.exists(draft_path):
                draft = json.load(open(draft_path))
                ids = [p['id'] for p in draft['spl']['points']]
                # only points that actually declare addresses participate in the
                # address-uniqueness check; derived/computed points carry no addr.
                addrs = [tuple(p['addrs']) for p in draft['spl']['points'] if p.get('addrs')]
                check('DRAFT STATUS IS field-draft', draft.get('status') == 'field-draft', draft.get('status'))
                check('DRAFT basedOn IS approved revision', draft.get('basedOn') == 'spl-1.0', draft.get('basedOn'))
                check('DRAFT REVISION CARRIES THE FIELD POINT', len(ids) == base_n + 1, f'base={base_n} draft={len(ids)}')
                check('DRAFT POINT IDS ARE UNIQUE', len(ids) == len(set(ids)), f'{len(ids)} points, {len(set(ids))} unique ids')
                check('DRAFT ADDRESSED-POINT ADDRS ARE UNIQUE', len(addrs) == len(set(addrs)), f'{len(addrs)} addressed points, {len(set(addrs))} unique addrs')
            else:
                check('DRAFT REVISION FILE WRITTEN TO DISK', False, draft_path)
            if os.path.exists(approved_path):
                approved = json.load(open(approved_path))
                approved_n = len(approved['spl']['points'])
                check('APPROVED spl-1.0 POINT COUNT UNCHANGED', approved_n == base_n, f'approved now has {approved_n}, expected {base_n}')
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
    print('PASS: qa5 ok')

asyncio.run(main())
