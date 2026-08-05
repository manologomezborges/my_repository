import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
URL = 'file://' + os.path.join(ROOT, 'dist', 'WitnessONE.html')
OUT = os.path.join(HERE, '_artifacts') + os.sep
os.makedirs(OUT, exist_ok=True)
errors=[]

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch()
        pg=await b.new_page(viewport={'width':1600,'height':950},accept_downloads=True)
        pg.on('console',lambda m: errors.append(f'[{m.type}] {m.text}') if m.type=='error' else None)
        pg.on('pageerror',lambda e: errors.append(f'[pageerror] {e}'))
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=OUT+'10_boot2.png')
        await pg.click('#btnConnect')
        await pg.wait_for_timeout(2600)
        await pg.screenshot(path=OUT+'10b_handshake.png')
        await pg.wait_for_timeout(6900)
        await pg.screenshot(path=OUT+'11_dash2.png')
        # open deck, run at x8
        await pg.click('#btnTest')
        await pg.wait_for_timeout(700)
        await pg.click('#tdSpeedChip')   # x8
        await pg.click('#btnTdRun')
        await pg.wait_for_timeout(12000)
        await pg.screenshot(path=OUT+'12_deck_running.png')
        # wait for completion (btnTdReport enabled)
        for _ in range(60):
            en = await pg.eval_on_selector('#btnTdReport','b=>!b.disabled')
            if en: break
            await pg.wait_for_timeout(2000)
        await pg.screenshot(path=OUT+'13_deck_done.png')
        # report
        await pg.click('#btnTdReport')
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=OUT+'14_report_top.png')
        await pg.eval_on_selector('#reportScroll','e=>e.scrollTop=e.scrollHeight/2')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+'15_report_mid.png')
        await pg.eval_on_selector('#reportScroll','e=>e.scrollTop=e.scrollHeight')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+'16_report_end.png')
        # downloads
        for btn,name in [('#btnDlHtml','sample_certificate.html'),('#btnDlCsv','sample_results.csv'),('#btnDlJson','sample_results.json')]:
            async with pg.expect_download() as dl:
                await pg.click(btn)
            d=await dl.value
            await d.save_as(OUT+name)
        print('DL OK')
        await b.close()
        # render downloaded certificate to PDF — NOTE: this writes into the
        # gitignored _artifacts dir under a distinct name so it never touches
        # the curated, tracked qa/Sample_FWT_Certificate.pdf sample.
        b=await pw.chromium.launch()
        pg=await b.new_page()
        await pg.goto('file://'+OUT+'sample_certificate.html')
        await pg.wait_for_timeout(800)
        await pg.pdf(path=OUT+'QA2_Sample_FWT_Certificate.pdf',format='A4',
                     margin={'top':'10mm','bottom':'10mm','left':'8mm','right':'8mm'},
                     print_background=True)
        await pg.screenshot(path=OUT+'17_cert_standalone.png',full_page=False)
        await b.close()
        print('CONSOLE ERRORS:' if errors else 'NO CONSOLE ERRORS')
        for e in errors[:20]: print(' ', e[:200])

asyncio.run(main())
