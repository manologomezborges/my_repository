import asyncio, subprocess, time, json, sys, urllib.request
from playwright.async_api import async_playwright

URL='file:///home/claude/witnessone/dist/WitnessONE.html'
OUT='/home/claude/witnessone/qa/'
AGENT='http://127.0.0.1:5710'
errors=[]

def get(path):
    return json.loads(urllib.request.urlopen(AGENT+path,timeout=6).read())

async def main():
    dev=subprocess.Popen([sys.executable,'/home/claude/witnessone/qa/modbus_device_sim.py','--port','1502'],
                         stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    ag=subprocess.Popen([sys.executable,'/home/claude/witnessone/agent/witnessone_agent.py'],
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(1.2)
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
            await pg.click('#btnLibClose')
            # real discovery against the Modbus device sim
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port','1502')
            await pg.click('#btnDiscover'); await pg.wait_for_timeout(2500)
            disc=await pg.text_content('#discLines'); print('REAL DISCOVERY MATCH:','MATCH' in disc and 'VERTIV' in disc)
            await pg.screenshot(path=OUT+'41_real_discovery.png')
            await pg.click('#btnDiscAdopt'); await pg.wait_for_timeout(400)
            # LIVE direct-only (no TOP Server running -> config offline path)
            await pg.click('#segLive')  # default link = DIRECT MODBUS
            await pg.click('#btnConnect'); await pg.wait_for_timeout(4500)
            await pg.screenshot(path=OUT+'42_handshake_direct.png')
            hs=await pg.text_content('#hsLines'); print('DIRECT-ONLY PATH:','DIRECT-ONLY' in hs, '| direct OK:','Direct Modbus via Agent' in hs)
            await pg.wait_for_timeout(6500)
            chip2=await pg.text_content('#simChipIn'); print('SOURCE CHIP:',chip2.strip())
            v08=await pg.text_content('#pv_P08'); v02=await pg.text_content('#pv_P02')
            print('LIVE P08/P02:',v08.strip(),'|',v02.strip())
            await pg.screenshot(path=OUT+'43_dash_direct.png')
            # live write through agent -> real FC06 to the device sim
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench'); await pg.wait_for_timeout(400)
            await pg.eval_on_selector('#spSlider','e=>{e.value=30;e.dispatchEvent(new Event("input"))}')
            await pg.click('#spApply'); await pg.wait_for_timeout(1600)
            rd=get('/modbus/read?template=vertiv-xdu1350b-cdu&ip=127.0.0.1&port=1502&unit=1')
            print('DEVICE 40001 AFTER WRITE:',rd['values'].get('40001'))
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')
            # run the witness test at x16 and verify record archived
            await pg.click('#btnTest'); await pg.wait_for_timeout(600)
            await pg.click('#tdSpeedChip'); await pg.click('#tdSpeedChip')  # x16
            await pg.click('#btnTdRun')
            for _ in range(70):
                if await pg.eval_on_selector('#btnTdReport','b=>!b.disabled'): break
                await pg.wait_for_timeout(2000)
            counts=await pg.text_content('#tdCounts'); print('TEST COUNTS:',counts.strip())
            runs=get('/records/runs'); print('AGENT RECORDS:',len(runs['runs']),runs['runs'][:1])
            await pg.click('#btnTdReport'); await pg.wait_for_timeout(1200)
            body=await pg.text_content('#reportScroll')
            print('CERT DATA SOURCE LIVE:','Direct Modbus via WitnessONE Agent' in body)
            await pg.screenshot(path=OUT+'44_cert_live.png')
            await b.close()
    finally:
        dev.terminate(); ag.terminate()
    print('PAGEERRORS:',errors if errors else 'none')

asyncio.run(main())
