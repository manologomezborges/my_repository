import asyncio
from playwright.async_api import async_playwright

URL='file:///home/claude/witnessone/dist/WitnessONE.html'
OUT='/home/claude/witnessone/qa/'
errors=[]

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        pg=await b.new_page(viewport={'width':1600,'height':950})
        pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(900)
        # 1) plain LIVE label
        print('SEG LIVE LABEL:', (await pg.text_content('#segLive')).strip())
        # 2) makes list
        makes=await pg.eval_on_selector('#make','e=>[...e.options].map(o=>o.value||o.textContent)')
        print('MAKES:', makes)
        print('DX UNIT present:', any('DX UNIT' in m for m in makes), '| EHOUSE gone:', not any('EHOUSE' in m.upper().replace('-','') for m in makes))
        # 3) expand LIVE -> link seg with modbus default
        await pg.click('#segLive'); await pg.wait_for_timeout(250)
        print('liveCfg visible:', await pg.is_visible('#liveCfg'))
        print('default: modbusPane', await pg.is_visible('#lvModbusPane'), '| topsPane', await pg.is_visible('#lvTopsPane'))
        await pg.screenshot(path=OUT+'70_live_modbus_default.png')
        await pg.click('#lvTops'); await pg.wait_for_timeout(250)
        print('after lvTops: modbusPane', await pg.is_visible('#lvModbusPane'), '| topsPane', await pg.is_visible('#lvTopsPane'), '| apiUrl vis', await pg.is_visible('#apiUrl'))
        await pg.screenshot(path=OUT+'71_live_topserver.png')
        await pg.click('#lvModbus'); await pg.wait_for_timeout(200)
        print('back to modbus:', await pg.is_visible('#lvModbusPane'), not await pg.is_visible('#lvTopsPane'))
        await b.close()
        # 4) sim connect per asset
        for mk in ['VERTIV','DELTA','ABB','DX UNIT','SCHNEIDER']:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(f'[{mk}] {e}'))
            await pg.goto(URL); await pg.wait_for_timeout(800)
            await pg.select_option('#make',mk); await pg.wait_for_timeout(300)
            await pg.click('#btnConnect'); await pg.wait_for_timeout(6500)
            tiles=await pg.eval_on_selector_all('#tiles .tile','els=>els.length')
            rows=await pg.eval_on_selector_all('#ptbody tr','els=>els.length')
            mm=await pg.text_content('#devMM')
            print(f'{mk:10s} tiles={tiles:2d} rows={rows:2d} devMM={mm.strip()}')
            if mk=='DX UNIT': await pg.screenshot(path=OUT+'72_dxunit_dash.png')
            await b.close()
    print('PAGEERRORS:', errors if errors else 'none')
asyncio.run(main())
