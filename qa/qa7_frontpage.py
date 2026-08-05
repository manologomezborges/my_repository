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
        pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(900)
        # 1) plain LIVE label
        print('SEG LIVE LABEL:', (await pg.text_content('#segLive')).strip())
        # 2) makes list
        makes=await pg.eval_on_selector('#make','e=>[...e.options].map(o=>o.value||o.textContent)')
        print('MAKES:', makes)
        dx_present = any('DX UNIT' in m for m in makes)
        ehouse_gone = not any('EHOUSE' in m.upper().replace('-','') for m in makes)
        print('DX UNIT present:', dx_present, '| EHOUSE gone:', ehouse_gone)
        check('DX UNIT PRESENT IN MAKES', dx_present, str(makes))
        check('EHOUSE ABSENT FROM MAKES', ehouse_gone, str(makes))
        # 3) expand LIVE -> link seg with modbus default
        await pg.click('#segLive'); await pg.wait_for_timeout(250)
        liveCfgVisible = await pg.is_visible('#liveCfg')
        print('liveCfg visible:', liveCfgVisible)
        check('LIVE CFG VISIBLE AFTER SEG LIVE', liveCfgVisible)
        modbusPane = await pg.is_visible('#lvModbusPane'); topsPane = await pg.is_visible('#lvTopsPane')
        print('default: modbusPane', modbusPane, '| topsPane', topsPane)
        check('MODBUS PANE IS DEFAULT LIVE LINK', modbusPane and not topsPane)
        await pg.screenshot(path=OUT+'70_live_modbus_default.png')
        await pg.click('#lvTops'); await pg.wait_for_timeout(250)
        modbusPane2=await pg.is_visible('#lvModbusPane'); topsPane2=await pg.is_visible('#lvTopsPane'); apiUrlVis=await pg.is_visible('#apiUrl')
        print('after lvTops: modbusPane', modbusPane2, '| topsPane', topsPane2, '| apiUrl vis', apiUrlVis)
        check('TOPS PANE SHOWN AFTER lvTops', topsPane2 and not modbusPane2 and apiUrlVis)
        await pg.screenshot(path=OUT+'71_live_topserver.png')
        await pg.click('#lvModbus'); await pg.wait_for_timeout(200)
        modbusPane3=await pg.is_visible('#lvModbusPane'); topsPane3=await pg.is_visible('#lvTopsPane')
        print('back to modbus:', modbusPane3, not topsPane3)
        check('BACK TO MODBUS PANE AFTER lvModbus', modbusPane3 and not topsPane3)
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
            # NOTE: the point-table body id is #ptRows (src/app/02_body.html,
            # written by UI.buildTable in src/app/07_ui.js) — #ptbody matches
            # nothing and always evaluates to an empty list.
            rows=await pg.eval_on_selector_all('#ptRows tr','els=>els.length')
            mm=await pg.text_content('#devMM')
            print(f'{mk:10s} tiles={tiles:2d} rows={rows:2d} devMM={mm.strip()}')
            check(f'{mk} POINT TABLE HAS ROWS', rows > 0, f'rows={rows}')
            if mk=='DX UNIT': await pg.screenshot(path=OUT+'72_dxunit_dash.png')
            await b.close()
    print('PAGEERRORS:', errors if errors else 'none')
    if failures:
        print('FAIL:', len(failures), 'check(s) failed:')
        for f in failures: print('  -', f)
        sys.exit(1)
    print('PASS: qa7 ok')
asyncio.run(main())
