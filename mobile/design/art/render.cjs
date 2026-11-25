// Renders each art/*.svg to PNG at 1x, 2x and 3x (Flutter resolution variants) with Chromium.
// Usage: node render.cjs <svgDir> <outDir> [name ...]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FONTS = '/opt/flutter/bin/cache/artifacts/material_fonts';
const face = (w, f) => `@font-face{font-family:Roboto;font-weight:${w};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(FONTS, f)).toString('base64')}) format('truetype');}`;
const css = face(400, 'Roboto-Regular.ttf') + face(500, 'Roboto-Medium.ttf') + face(700, 'Roboto-Bold.ttf') + face(900, 'Roboto-Black.ttf');

(async () => {
  const [svgDir, outDir, ...only] = process.argv.slice(2);
  const names = fs.readdirSync(svgDir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).filter((n) => !only.length || only.includes(n));
  const browser = await chromium.launch();
  for (const name of names) {
    const svg = fs.readFileSync(path.join(svgDir, name + '.svg'), 'utf8');
    const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    const w = Number(m[1]);
    const h = Number(m[2]);
    for (const scale of [1, 2, 3]) {
      const page = await browser.newPage({ viewport: { width: Math.ceil(w), height: Math.ceil(h) }, deviceScaleFactor: scale });
      await page.setContent(`<!doctype html><html><head><style>${css}html,body{margin:0;background:transparent}svg{display:block;font-family:Roboto}</style></head><body>${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const dir = scale === 1 ? outDir : path.join(outDir, `${scale}.0x`);
      fs.mkdirSync(dir, { recursive: true });
      await page.locator('svg').screenshot({ path: path.join(dir, name + '.png'), omitBackground: true });
      await page.close();
    }
    console.log('rendered', name, w + 'x' + h);
  }
  await browser.close();
})();
