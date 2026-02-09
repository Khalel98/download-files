const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const TARGET_URL = 'https://pharmec.by/catalog/signalizatory-zagazovannosti-bytovye/signalizator-zagazovannosti-fst-06-i/';
const DOWNLOAD_DIR = './downloads';

// =========================
// Очистка папки downloads
// =========================
if (fs.existsSync(DOWNLOAD_DIR)) {
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

function downloadFile(url, filePath) {
  const client = url.startsWith('https') ? https : http;

  return new Promise((resolve, reject) => {
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(`Failed ${url}`);
        return;
      }

      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', reject);
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

  // Собираем все ссылки
  const links = await page.evaluate(() => {
    const urls = new Set();

    document.querySelectorAll('img').forEach(img => {
      if (img.src) urls.add(img.src);
    });

    document.querySelectorAll('a').forEach(a => {
      if (a.href && a.href.match(/\.(pdf|jpg|jpeg|png|gif|webp)$/i)) {
        urls.add(a.href);
      }
    });

    return Array.from(urls);
  });

  console.log(`Найдено файлов: ${links.length}`);

  for (const url of links) {
    try {
      const filename = path.basename(new URL(url).pathname);
      const filePath = path.join(DOWNLOAD_DIR, filename);
      console.log('Скачиваю:', filename);
      await downloadFile(url, filePath);
    } catch (e) {
      console.error('Ошибка:', url, e.message);
    }
  }

  await browser.close();
})();
