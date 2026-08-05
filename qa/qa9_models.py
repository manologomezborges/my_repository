import asyncio
from playwright.async_api import async_playwright
URL='file:///home/claude/witnessone/dist/WitnessONE.html'
OUT='/home/claude/witnessone/qa/'
errors=[]
async def main():
    async with async_playwright() as pw:
        for mk,slug in [('VERTIV','cdu'),('DELTA','ups'),('ABB','acb'),('DX UNIT','dx'),('SCHNEIDER','pqm')]:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e,mk=mk: errors.append(f'[{mk}] {e}'))
            await pg.goto(URL); await pg.wait_for_timeout(800)
            await pg.select_option('#make',mk); await pg.wait_for_timeout(300)
            await pg.click('#btnConnect'); await pg.wait_for_timeout(9000)
            await pg.screenshot(path=f'{OUT}90_{slug}.png')
            if slug in ('acb','pqm'):
                await pg.click('#btnXray'); await pg.wait_for_timeout(1600)
                await pg.screenshot(path=f'{OUT}90_{slug}_xray.png')
            print(mk,'ok')
            await b.close()
    print('PAGEERRORS:', errors if errors else 'none')
asyncio.run(main())
