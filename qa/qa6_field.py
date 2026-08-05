import asyncio, subprocess, time, json, sys, glob, urllib.request
from playwright.async_api import async_playwright

APP='http://127.0.0.1:5710'
OUT='/home/claude/witnessone/qa/'
errors=[]
def get(p): return json.loads(urllib.request.urlopen(APP+p,timeout=6).read())
def post(p,b):
    rq=urllib.request.Request(APP+p,data=json.dumps(b).encode(),headers={'Content-Type':'application/json'})
    return json.loads(urllib.request.urlopen(rq,timeout=20).read())

async def main():
    app=subprocess.Popen([sys.executable,'/home/claude/witnessone/agent/witnessone_agent.py',
                          '--headless','--demo-device'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(1.4)
    try:
        # --- agent register sweep directly ---
        sc=post('/modbus/scan',{'ip':'127.0.0.1','port':1502,'unit':1})
        addrs=[f['addr'] for f in sc['found']]
        print('SWEEP found',len(addrs),'regs · has 30021(NEW):',30021 in addrs,'· probed',sc['probed'])
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(str(e)))
            pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(APP+'/'); await pg.wait_for_timeout(1600)
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port','1502')
            # register-range sweep in UI
            await pg.click('#btnDiscover'); await pg.wait_for_timeout(4000)
            disc=await pg.text_content('#discLines')
            print('UI SWEEP: NEW 30021 flagged:', '30021' in disc and 'NOT in the SPL' in disc,
                  '| responding overlay:', 'SPL registers responding' in disc)
            await pg.screenshot(path=OUT+'60_register_sweep.png')
            await pg.click('#btnDiscClose')
            # connect LIVE direct
            await pg.click('#segLive')  # default link = DIRECT MODBUS
            await pg.click('#btnConnect'); await pg.wait_for_timeout(9000)
            print('SAFE CHIP visible:', await pg.is_visible('#safeChip'),
                  '| text:', (await pg.text_content('#safeChip')).strip())
            # write blocked while SAFE
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench'); await pg.wait_for_timeout(400)
            await pg.eval_on_selector('#spSlider','e=>{e.value=30;e.dispatchEvent(new Event("input"))}')
            await pg.click('#spApply'); await pg.wait_for_timeout(800)
            before=post('/modbus/scan',{'ip':'127.0.0.1','port':1502,'unit':1,'ranges':[{'fc':3,'start':0,'count':1}]})
            sp_before=[f for f in before['found'] if f['addr']==40001]
            print('SAFE blocked write — device 40001 still:', sp_before[0]['value'] if sp_before else '?')
            # arm + witnessed setpoint test W06
            await pg.click('#btnArmWrites'); await pg.wait_for_timeout(300)
            print('ARMED chip:', (await pg.text_content('#safeChip')).strip())
            await pg.click('#btnMenu'); await pg.wait_for_timeout(150); await pg.click('#btnBench')  # close
            # open deck, witnessed mode
            await pg.click('#btnTest'); await pg.wait_for_timeout(500)
            await pg.click('#tdModeWit'); await pg.wait_for_timeout(600)
            await pg.screenshot(path=OUT+'61_witnessed_deck.png')
            # arm W06 setpoint step
            await pg.eval_on_selector_all('#twb_W06 button','bs=>bs[0].click()')
            await pg.wait_for_timeout(1500)
            # simulate the FIELD action: vendor changes setpoint on the unit -> write via agent
            post('/modbus/write',{'ip':'127.0.0.1','port':1502,'unit':1,'addr':40001,'value':300})
            await pg.wait_for_timeout(3500)  # tool auto-detects trigger from real reads
            w06=await pg.text_content('#twt_W06')
            print('W06 timeline after field change:', w06.strip()[:80])
            # confirm event, watch recovery (T2 tracks to 30.0), then it auto-recovers
            btns=await pg.query_selector_all('#twb_W06 button')
            # phase should be triggered -> click "Event OK"
            await pg.eval_on_selector_all('#twb_W06 button','bs=>{for(const b of bs){if(/Event OK/.test(b.textContent)){b.click();return}}}')
            await pg.wait_for_timeout(8000)  # let T2 converge to SP in the demo device
            await pg.eval_on_selector_all('#twb_W06 button','bs=>{for(const b of bs){if(/PASS/.test(b.textContent)){b.click();return}}}')
            await pg.wait_for_timeout(1200)
            cls=await pg.get_attribute('#tw_W06','class')
            print('W06 final class:', cls, '| PASS:', 'pass' in (cls or ''))
            await pg.screenshot(path=OUT+'62_witnessed_pass.png')
            # certificate carries witnessed section
            await pg.click('#btnTdReport'); await pg.wait_for_timeout(1200)
            body=await pg.text_content('#reportScroll')
            print('CERT witnessed section:', 'Witnessed field tests' in body, '| W06 row:', 'Setpoint change response' in body)
            await pg.screenshot(path=OUT+'63_cert_witnessed.png')
            runs=get('/records/runs'); print('RECORDS:',len(runs['runs']))
            await b.close()
    finally:
        app.terminate()
    print('PAGEERRORS:',errors if errors else 'none')

asyncio.run(main())
