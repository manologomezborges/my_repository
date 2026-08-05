import asyncio, subprocess, time, json, urllib.request, base64, sys
from playwright.async_api import async_playwright

URL='file:///home/claude/witnessone/dist/WitnessONE.html'
OUT='/home/claude/witnessone/qa/'
API='http://127.0.0.1:57418'
AUTH='Basic '+base64.b64encode(b'Administrator:witness').decode()
errors=[]

def api_get(path):
    rq=urllib.request.Request(API+path); rq.add_header('Authorization',AUTH)
    return json.loads(urllib.request.urlopen(rq,timeout=5).read())

async def main():
    mock=subprocess.Popen([sys.executable,'/home/claude/witnessone/dist/witnessone_mock_topserver.py'],
                          stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
            pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(URL); await pg.wait_for_timeout(1000)
            # LIVE mode setup
            await pg.click('#segLive')
            await pg.click('#lvTops')
            await pg.fill('#apiPass','witness')
            await pg.fill('#iotUrl',API)
            await pg.click('#btnApiTest'); await pg.wait_for_timeout(1500)
            st=await pg.text_content('#apiStatus'); print('TEST API:',st.strip())
            # explorer shows seeded project
            await pg.click('#btnExplore'); await pg.wait_for_timeout(1500)
            tree=await pg.text_content('#explTree'); print('EXPLORER:', 'CH_PLANT' in tree and 'AHU_07' in tree)
            await pg.screenshot(path=OUT+'30_explorer.png')
            await pg.click('#btnExplOk'); await pg.wait_for_timeout(400)
            # connect live
            await pg.click('#btnConnect'); await pg.wait_for_timeout(4000)
            await pg.screenshot(path=OUT+'31_handshake_live.png')
            await pg.wait_for_timeout(7000)
            await pg.screenshot(path=OUT+'32_dash_live.png')
            chip=await pg.text_content('#simChipIn'); print('CHIP:',chip.strip())
            v02=await pg.text_content('#pv_P02'); print('P02 LIVE VALUE:',v02.strip())
            v08=await pg.text_content('#pv_P08'); print('P08 LIVE VALUE:',v08.strip())
            # verify provisioning landed on mock
            tags=api_get('/config/v1/project/channels/CH_FWT01/devices/CDU_01/tags')
            print('MOCK TAGS CREATED:',len(tags))
            # live write via bench
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench'); await pg.wait_for_timeout(400)
            await pg.click('#btnArmWrites'); await pg.wait_for_timeout(300)   # arm writes (SAFE gate)
            await pg.eval_on_selector('#spSlider','e=>{e.value=30;e.dispatchEvent(new Event("input"))}')
            await pg.click('#spApply'); await pg.wait_for_timeout(1500)
            rd=json.loads(urllib.request.urlopen(API+'/iotgateway/read?ids='+
                urllib.parse.quote('CH_FWT01.CDU_01.P04_Secondary_Temperature_Setpoint_P301'),timeout=5).read())
            print('MOCK SP AFTER WRITE (raw):',rd['readResults'][0]['v'])
            await pg.screenshot(path=OUT+'33_live_write.png')
            await b.close()
            # failure path: bad port -> doctor
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            await pg.goto(URL); await pg.wait_for_timeout(900)
            await pg.click('#segLive')
            await pg.click('#lvTops')
            await pg.fill('#apiUrl','http://127.0.0.1:59999')
            await pg.click('#btnApiTest'); await pg.wait_for_timeout(8000)
            doc=await pg.is_visible('#doctorModal'); print('DOCTOR SHOWN:',doc)
            await pg.screenshot(path=OUT+'34_doctor.png')
            await pg.click('#btnDocSim'); await pg.wait_for_timeout(500)
            boot=await pg.is_visible('#bootCard'); print('BACK TO BOOT SIM:',boot)
            await b.close()
    finally:
        mock.terminate()
    print('PAGEERRORS:',errors if errors else 'none')

import urllib.parse
asyncio.run(main())
