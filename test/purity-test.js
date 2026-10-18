/* Seek-purity test: seek(t) must be a pure function of t.
 * seek(2.0) → seek(4.0) → seek(2.0) must give identical pixels.
 * Usage: node test/purity-test.js [scene.html]
 */
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const scenePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'demo', 'demo.html'));
const projectRoot = path.join(__dirname, '..');
const RUNTIME_DIR = path.join(projectRoot, 'runtime');

function inlineRuntime(html) {
  return html.replace(
    /<script\s+src=["']\/__km\/([^"']+)["'][^>]*>\s*<\/script>/g,
    (m, name) => {
      const code = fs.readFileSync(path.join(RUNTIME_DIR, path.basename(name)), 'utf8');
      return '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
    }
  );
}

(async () => {
  const html = inlineRuntime(fs.readFileSync(scenePath, 'utf8'));
  const tmpHtml = path.join(require('os').tmpdir(), 'km-purity-' + process.pid + '.html');
  fs.writeFileSync(tmpHtml, html);

  const browser = await puppeteer.launch({
    executablePath: '/opt/meta-chromium/chrome',
    headless: 'new',
    userDataDir: path.join(projectRoot, '.chrome-profile'),
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars',
           '--force-device-scale-factor=1',
           '--disable-features=BlockInsecurePrivateNetworkRequests']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto('file://' + tmpHtml, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__km && window.__km.version === 1', { timeout: 30000 });
  await page.evaluate(() => window.__km.ready());

  async function shotAt(t) {
    await page.evaluate((tt) => window.__km.seek(tt), t);
    const buf = await page.screenshot({ type: 'png' });
    return crypto.createHash('md5').update(buf).digest('hex');
  }

  const a = await shotAt(2.0);
  await shotAt(4.0);
  const b = await shotAt(2.0);
  const c = await shotAt(0.0);
  const d = await shotAt(4.0);
  const e = await shotAt(4.0);

  let fail = 0;
  function check(name, x, y) {
    const ok = x === y;
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
    if (!ok) fail++;
  }
  check('seek(2.0) stable across seeks', a, b);
  check('seek(4.0) repeatable', d, e);
  check('distinct times differ', a === c ? 'same' : 'different', 'different');

  await browser.close();
  fs.unlinkSync(tmpHtml);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('PURITY TEST ERROR:', e.message); process.exit(1); });
