const { chromium } = require('/tmp/claude-0/-home-user-Marketing-CRM/cda677d3-5399-55f3-b900-902225faa9ab/scratchpad/node_modules/playwright')
const D = __dirname
;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: false, args: ['--headless=new'] })
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2.5 })
  await page.goto('file://' + D + '/mockups.html')
  await page.waitForTimeout(800)
  for (const id of ['phone-ai', 'phone-shop', 'phone-pay', 'phone-campaign', 'phone-support', 'phone-launch', 'dashboard']) {
    await (await page.$('#' + id)).screenshot({ path: `${D}/img/${id}.png`, omitBackground: true })
  }
  // Colourful backgrounds for the dark slides
  const bg = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 })
  const blob = (x, y, size, color, blur = 140) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;background:${color};filter:blur(${blur}px)"></div>`
  const scene = blobs => `<html><body style="margin:0;width:1600px;height:900px;overflow:hidden;position:relative;background:#0b1636">${blobs}<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.07) 1.2px,transparent 1.2px);background-size:26px 26px"></div></body></html>`
  await bg.setContent(scene(blob(-150, -200, 700, 'rgba(29,91,234,.75)') + blob(1050, -150, 650, 'rgba(0,168,132,.55)') + blob(950, 560, 600, 'rgba(29,91,234,.45)', 170)))
  await bg.screenshot({ path: `${D}/img/bg-cover.png` })
  await bg.setContent(scene(blob(-200, 350, 700, 'rgba(0,168,132,.5)') + blob(1100, -200, 700, 'rgba(29,91,234,.7)')))
  await bg.screenshot({ path: `${D}/img/bg-section.png` })
  await browser.close()
})()
