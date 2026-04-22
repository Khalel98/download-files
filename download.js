const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://neal.fun/spend';
const DOWNLOAD_DIR = './downloads';

// Cloudflare часто блокирует headless. Для этого сайта: HEADLESS=0 node download.js
const HEADLESS = process.env.HEADLESS !== '0';

async function isCloudflareChallenge(page) {
  const title = await page.title();
  if (/just a moment|один момент|checking your browser/i.test(title)) return true;
  const cfFrame = await page.locator('iframe[src*="challenges.cloudflare"]').count();
  return cfFrame > 0;
}

async function collectImageUrls(page) {
  return page.evaluate(() => {
    const urls = new Set();

    const add = (u) => {
      if (u && /^https?:\/\//i.test(u)) urls.add(u);
    };

    document.querySelectorAll('img').forEach((img) => {
      add(img.currentSrc || img.src);
      if (img.srcset) {
        img.srcset.split(',').forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          add(u);
        });
      }
    });

    document.querySelectorAll('source[srcset]').forEach((s) => {
      s.srcset.split(',').forEach((part) => {
        const u = part.trim().split(/\s+/)[0];
        add(u);
      });
    });

    document.querySelectorAll('a[href]').forEach((a) => {
      if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(a.href)) add(a.href);
    });

    return Array.from(urls);
  });
}

async function scrollForLazyImages(page) {
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.max(400, innerHeight * 0.9)));
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

// =========================
// Очистка папки downloads
// =========================
if (fs.existsSync(DOWNLOAD_DIR)) {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: HEADLESS,
    channel: process.env.PW_CHANNEL || undefined,
  });
  const page = await browser.newPage();

  await page.goto(TARGET_URL, {
    waitUntil: 'load',
    timeout: 90_000,
  });

  if (await isCloudflareChallenge(page)) {
    if (HEADLESS) {
      await browser.close();
      console.error(
        'Страница Cloudflare («Один момент…») в headless не открывается как обычный сайт.\n' +
          'Запустите с видимым браузером (при необходимости пройдите проверку в окне):\n' +
          '  PowerShell:  $env:HEADLESS="0"; node download.js\n' +
          '  cmd:         set HEADLESS=0 && node download.js\n' +
          'Системный Chrome (часто стабильнее): $env:HEADLESS="0"; $env:PW_CHANNEL="chrome"; node download.js'
      );
      process.exit(1);
    }
    console.log('Ожидаю прохождение проверки Cloudflare в открытом окне…');
    await page.waitForFunction(
      () =>
        !/just a moment|один момент|checking your browser/i.test(document.title) &&
        document.querySelectorAll('iframe[src*="challenges.cloudflare"]').length === 0,
      { timeout: 180_000 }
    );
    await page.waitForLoadState('load');
  }

  await scrollForLazyImages(page);
  await page.waitForTimeout(1500);

  const links = await collectImageUrls(page);

  console.log(`Найдено URL картинок: ${links.length}`);

  let ok = 0;
  for (const url of links) {
    try {
      let pathname;
      try {
        pathname = new URL(url).pathname;
      } catch {
        continue;
      }
      let filename = path.basename(pathname) || 'image';
      if (!/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename)) {
        filename += '.img';
      }
      const filePath = path.join(DOWNLOAD_DIR, filename);
      const res = await page.request.get(url, { timeout: 60_000 });
      if (!res.ok()) {
        console.error('HTTP', res.status(), url);
        continue;
      }
      await fs.promises.writeFile(filePath, await res.body());
      console.log('Скачано:', filename);
      ok++;
    } catch (e) {
      console.error('Ошибка:', url, e.message || e);
    }
  }

  console.log(`Готово: ${ok} файлов в ${DOWNLOAD_DIR}`);
  await browser.close();
})();
