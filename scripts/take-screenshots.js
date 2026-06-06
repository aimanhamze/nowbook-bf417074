import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3 };
const BASE_URL = 'http://localhost:8080';

const PAGES = [
  { name: '01-home',             url: '/',                                                           title: 'Home' },
  { name: '02-explore',          url: '/explore',                                                    title: 'Explore' },
  { name: '03-provider-profile', url: '/provider/feeac115-5945-411a-b014-a2313e166495',              title: 'Provider Profile' },
  { name: '04-book-appointment', url: '/book/feeac115-5945-411a-b014-a2313e166495',                  title: 'Book Appointment' },
  { name: '05-login',            url: '/auth',                                                       title: 'Login' },
];

const INSTAGRAM = {
  post:  { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

const RAW_DIR  = path.join(ROOT, 'screenshots');
const POST_DIR = path.join(RAW_DIR, 'post');
const STORY_DIR = path.join(RAW_DIR, 'story');

[RAW_DIR, POST_DIR, STORY_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function takeScreenshot(page, url, outFile) {
  console.log(`  Navigating to ${url}…`);
  await page.goto(BASE_URL + url, { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1500);
  await page.screenshot({ path: outFile, fullPage: false });
  console.log(`  Saved raw: ${outFile}`);
}

async function resizeForInstagram(srcFile, baseName) {
  const src = sharp(srcFile);

  // Post: 1080×1080 — crop/pad to square keeping content centered
  const postFile = path.join(POST_DIR, baseName + '.jpg');
  await src.clone()
    .resize(INSTAGRAM.post.width, INSTAGRAM.post.height, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255 },
    })
    .jpeg({ quality: 92 })
    .toFile(postFile);
  console.log(`  Post:  ${postFile}`);

  // Story: 1080×1920 — scale to fit width, pad top/bottom with white
  const storyFile = path.join(STORY_DIR, baseName + '.jpg');
  await src.clone()
    .resize(INSTAGRAM.story.width, INSTAGRAM.story.height, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255 },
    })
    .jpeg({ quality: 92 })
    .toFile(storyFile);
  console.log(`  Story: ${storyFile}`);
}

(async () => {
  console.log('Launching Chromium…');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  );

  // Accept Hebrew locale
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' });

  for (const pg of PAGES) {
    console.log(`\n[${pg.title}]`);
    const rawFile = path.join(RAW_DIR, pg.name + '.png');

    try {
      await takeScreenshot(page, pg.url, rawFile);
      await resizeForInstagram(rawFile, pg.name);
    } catch (err) {
      console.error(`  ERROR on ${pg.title}:`, err.message);
    }
  }

  await browser.close();

  console.log('\n✓ Done. Files saved:');
  console.log(`  Raw PNGs  → screenshots/`);
  console.log(`  Post JPGs → screenshots/post/   (1080×1080)`);
  console.log(`  Story JPGs→ screenshots/story/  (1080×1920)`);
})();
