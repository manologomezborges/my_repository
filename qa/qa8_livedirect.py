import asyncio, subprocess, time, sys, json, urllib.request
from playwright.async_api import async_playwright

OUT='/home/claude/witnessone/qa/'
errors=[]

async def main():
    dev=subprocess.Popen([sys.executable,'qa/modbus_device_sim.py','--port','1502'],
                         stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    ag=subprocess.Popen([sys.executable,'agent/witnessone_agent.py','--headless'],
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(2.0)
    try:
        st=json.loads(urllib.request.urlopen('http://127.0.0.1:5710/agent/status',timeout=5).read())
        print('AGENT:',st.get('agent'),st.get('version'))
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
            await pg.goto('http://127.0.0.1:5710/'); await pg.wait_for_timeout(1200)
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port','1502')
            await pg.click('#segLive'); await pg.wait_for_timeout(250)   # default = DIRECT MODBUS
            print('modbus pane default:', await pg.is_visible('#lvModbusPane'))
            await pg.click('#btnConnect'); await pg.wait_for_timeout(4500)
            hs=await pg.text_content('#hsLines'); 
            print('HS has direct-modbus cmd:', '--direct-modbus' in hs)
            print('HS FULL LIVE:', 'FULL LIVE telemetry' in hs)
            await pg.screenshot(path=OUT+'80_hs_direct.png')
            await pg.wait_for_timeout(6000)
            chip=await pg.text_content('#simChipIn'); print('CHIP:',chip.strip())
            rows=await pg.eval_on_selector_all('#ptRows tr','els=>els.length')
            rx=await pg.text_content('#rxChip'); print('ROWS:',rows,'| RX:',rx.strip())
            await pg.screenshot(path=OUT+'81_dash_direct.png')
            await b.close()
    finally:
        dev.terminate(); ag.terminate()
    print('PAGEERRORS:', errors if errors else 'none')
asyncio.run(main())
