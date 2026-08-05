import asyncio, os, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'file://' + os.path.join(ROOT, 'dist', 'WitnessONE.html')
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
errors=[]
failures=[]

def check(name, ok, detail=''):
    print(f'{name}: {ok}' + (f' | {detail}' if detail else ''))
    if not ok: failures.append(f'{name}' + (f' ({detail})' if detail else ''))

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        pg=await b.new_page(viewport={'width':1600,'height':950})
        pg.on('console',lambda m: errors.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
        pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
        await pg.goto(URL)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=OUT+'01_boot.png')
        # discovery quick check
        await pg.click('#btnDiscover')
        await pg.wait_for_timeout(5200)
        await pg.screenshot(path=OUT+'02_discovery.png')
        await pg.click('#btnDiscAdopt')
        await pg.wait_for_timeout(400)
        # connect
        await pg.click('#btnConnect')
        await pg.wait_for_timeout(3200)
        await pg.screenshot(path=OUT+'03_handshake.png')
        await pg.wait_for_timeout(4500)   # finish handshake + start assembly
        await pg.screenshot(path=OUT+'04_assembling.png')
        await pg.wait_for_timeout(4500)   # assembled
        await pg.screenshot(path=OUT+'05_dashboard.png')
        # xray
        await pg.click('#btnXray')
        await pg.wait_for_timeout(1600)
        await pg.screenshot(path=OUT+'06_xray.png')
        await pg.click('#btnXray')
        # bench + fault (QA-2 coverage: open via menu, then re-open the menu and
        # click Test Bench again to CLOSE it — this is exactly the click sequence
        # that used to dead-end on the #bench overlay painting over #menuPanel)
        await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')
        await pg.wait_for_timeout(600)
        bench_open = await pg.eval_on_selector('#bench', 'e=>e.classList.contains("open")')
        check('BENCH OPENED FROM MENU', bench_open)
        await pg.click('.fbtn[data-f="leak"]')
        await pg.wait_for_timeout(2600)
        await pg.screenshot(path=OUT+'07_leak.png')
        await pg.click('.fbtn[data-f="leak"]')
        await pg.click('#btnClearF')
        await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')
        await pg.wait_for_timeout(400)
        bench_closed = await pg.eval_on_selector('#bench', 'e=>!e.classList.contains("open")')
        check('BENCH CLOSED FROM MENU (re-opens menu, not stuck under drawer)', bench_closed)
        # point selection
        await pg.click('#pr_P08')
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=OUT+'08_pointdetail.png')
        print('CONSOLE ISSUES:' if errors else 'NO CONSOLE ISSUES')
        for e in errors[:30]: print(' ', e[:220])
        await b.close()
    if failures:
        print('FAIL:', len(failures), 'check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print('PASS: qa1 ok')

asyncio.run(main())
