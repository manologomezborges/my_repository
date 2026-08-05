import asyncio, sys
from playwright.async_api import async_playwright

URL='file:///home/claude/witnessone/dist/WitnessONE.html'
OUT='/home/claude/witnessone/qa/'
errors=[]

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
        # bench + fault
        await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')
        await pg.wait_for_timeout(600)
        await pg.click('.fbtn[data-f="leak"]')
        await pg.wait_for_timeout(2600)
        await pg.screenshot(path=OUT+'07_leak.png')
        await pg.click('.fbtn[data-f="leak"]')
        await pg.click('#btnClearF')
        await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')
        # point selection
        await pg.click('#pr_P08')
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=OUT+'08_pointdetail.png')
        print('CONSOLE ISSUES:' if errors else 'NO CONSOLE ISSUES')
        for e in errors[:30]: print(' ', e[:220])
        await b.close()

asyncio.run(main())
