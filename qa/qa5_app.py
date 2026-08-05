import asyncio, subprocess, time, json, sys, os, glob, urllib.request
from playwright.async_api import async_playwright

APP='http://127.0.0.1:5710'
OUT='/home/claude/witnessone/qa/'
errors=[]

def get(path):
    return json.loads(urllib.request.urlopen(APP+path,timeout=6).read())

async def main():
    # ONE process: agent + UI server + built-in demo CDU
    app=subprocess.Popen([sys.executable,'/home/claude/witnessone/agent/witnessone_agent.py',
                          '--headless','--demo-device'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(1.4)
    try:
        print('STATUS:',get('/agent/status'))
        async with async_playwright() as pw:
            b=await pw.chromium.launch()
            pg=await b.new_page(viewport={'width':1600,'height':950})
            pg.on('pageerror',lambda e: errors.append(str(e)))
            pg.on('dialog',lambda d: asyncio.ensure_future(d.accept()))
            await pg.goto(APP+'/')            # UI served BY the app itself
            await pg.wait_for_timeout(1800)
            print('AGENT CHIP:',(await pg.text_content('#agentChip')).strip())
            # discovery against the built-in demo device
            await pg.fill('#ip','127.0.0.1'); await pg.fill('#port','1502')
            await pg.click('#btnDiscover'); await pg.wait_for_timeout(3500)
            chip=await pg.text_content('#discChipTxt'); adoptable=await pg.eval_on_selector('#btnDiscAdopt','b=>!b.disabled')
            print('DISCOVERY MATCH:', adoptable and 'MATCH' in chip.upper(), '|', chip.strip()[:60])
            await pg.click('#btnDiscAdopt'); await pg.wait_for_timeout(300)
            # LIVE direct
            await pg.click('#segLive')  # default link = DIRECT MODBUS
            await pg.click('#btnConnect'); await pg.wait_for_timeout(9500)
            print('CHIP:',(await pg.text_content('#simChipIn')).strip())
            print('RX:',(await pg.text_content('#rxChip')).strip())
            # field-add the NEW register the firmware exposes (30021 T2b) — not in SPL
            await pg.click('#btnAddReg'); await pg.wait_for_timeout(300)
            await pg.fill('#rgName','Secondary Supply Temperature T2b')
            await pg.fill('#rgAddr','30021'); await pg.fill('#rgGain','0.1')
            await pg.fill('#rgUnits','oC'); await pg.fill('#rgMin','-5'); await pg.fill('#rgMax','70')
            await pg.click('#btnRegAdd'); await pg.wait_for_timeout(2600)
            row=await pg.is_visible('#pr_C01'); v=await pg.text_content('#pv_C01')
            print('C01 ROW:',row,'| LIVE VALUE:',v.strip(),'(expect ~33.x = T2b over real Modbus)')
            print('RX AFTER ADD:',(await pg.text_content('#rxChip')).strip())
            await pg.screenshot(path=OUT+'50_field_added_register.png')
            # template persisted + commit queued on the agent
            tpl=get('/registry/devices')['templates'][0]
            n=len(tpl['spl']['points'])
            pend=glob.glob('/home/claude/witnessone/agent/pending_commits/*.json')
            print('AGENT TEMPLATE POINTS:',n,'| PENDING COMMITS:',len(pend))
            if pend:
                pc=json.load(open(pend[-1]))
                print('COMMIT NOTE:',pc['note'],'| carries template:',bool(pc.get('template')))
            await b.close()
    finally:
        app.terminate()
    print('PAGEERRORS:',errors if errors else 'none')

asyncio.run(main())
