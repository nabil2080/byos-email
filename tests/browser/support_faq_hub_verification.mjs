import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('../../apps/webmail/node_modules/puppeteer-core');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runVerification() {
  console.log('--- Starting BYOS Public Support FAQ Verification ---');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // 1. Navigate to http://localhost:3002/support
  console.log('Navigating to http://localhost:3002/support ...');
  await page.goto('http://localhost:3002/support', { waitUntil: 'networkidle0' });

  // 2. Assert Title & Color
  const titleText = await page.$eval('h1', (el) => el.innerText.trim());
  assert(titleText === 'How can we help you?', `Title matches 'How can we help you?' (got: ${titleText})`);

  const titleColor = await page.$eval('h1', (el) => window.getComputedStyle(el).color);
  assert(
    titleColor.includes('128, 0, 32') || titleColor.includes('800020'),
    `Title has burgundy tone (computed: ${titleColor})`
  );

  // 3. Assert Search Input
  const searchPlaceholder = await page.$eval('input[aria-label="Please enter your question"]', (el) => el.getAttribute('placeholder'));
  assert(searchPlaceholder === 'Please enter your question', `Search input placeholder matches (got: ${searchPlaceholder})`);

  // 4. Assert Subtitle
  const subtitleText = await page.$eval('h2', (el) => el.innerText.trim());
  assert(subtitleText === 'Frequently Asked Questions', `Subtitle matches (got: ${subtitleText})`);

  // 5. Assert 4 Category Cards
  const categoryLabels = await page.$$eval('.grid.grid-cols-2.md\\:grid-cols-4 button span', (els) =>
    els.map((e) => e.innerText.trim())
  );
  console.log('Category cards detected:', categoryLabels);
  assert(categoryLabels.length === 4, `Found 4 category cards (got ${categoryLabels.length})`);
  assert(categoryLabels.includes('General questions'), `Has 'General questions' card`);
  assert(categoryLabels.includes('Security and Privacy'), `Has 'Security and Privacy' card`);
  assert(categoryLabels.includes('How to use BYOS'), `Has 'How to use BYOS' card`);
  assert(categoryLabels.includes('Payment'), `Has 'Payment' card`);

  // 6. Assert Initial Featured Accordion Items
  const accordionQuestions = await page.$$eval('.space-y-3 button span.font-semibold', (els) =>
    els.map((e) => e.innerText.trim())
  );
  console.log('Initial Accordions detected:', accordionQuestions);
  assert(accordionQuestions.includes("I can't access my account"), `Has "I can't access my account"`);
  assert(accordionQuestions.includes('I have found a bug'), `Has 'I have found a bug'`);
  assert(accordionQuestions.includes('I would like to report abuse'), `Has 'I would like to report abuse'`);
  assert(accordionQuestions.includes('I have a business request'), `Has 'I have a business request'`);

  // Initial Desktop Screenshot
  await page.screenshot({ path: path.join(artifactsDir, 'public_support_initial_desktop.png') });
  console.log('Saved public_support_initial_desktop.png');

  // 7. Test Accordion Expand / Interaction
  console.log('Testing accordion expand on "I can\'t access my account"...');
  // First item is expanded by default; verify its content
  const recoveryLinkText = await page.$eval('a[href*="/recovery"]', (el) => el.innerText.trim());
  assert(recoveryLinkText.includes('Recovery Portal'), `Recovery portal link visible (got: ${recoveryLinkText})`);

  // Test feedback button
  console.log('Testing helpful feedback micro-interaction...');
  const feedbackBtn = await page.$('button::-p-text(👍 Yes)');
  if (feedbackBtn) {
    await feedbackBtn.click();
    await sleep(200);
    const feedbackConfirm = await page.$eval('.text-emerald-700', (el) => el.innerText.trim());
    assert(feedbackConfirm.includes('Thanks for your feedback'), `Feedback confirmation shown (got: ${feedbackConfirm})`);
  }

  // 8. Test Category Selection (Click "Security and Privacy")
  console.log('Testing category card click: "Security and Privacy"...');
  const secCard = await page.$('button::-p-text(Security and Privacy)');
  assert(secCard !== null, 'Found Security and Privacy card');
  await secCard.click();
  await sleep(300);

  const filterNotice = await page.$eval('.bg-\\[\\#FAF7F2\\] span', (el) => el.innerText.trim());
  assert(filterNotice.includes('Security and Privacy'), `Filter notice displays Security and Privacy (got: ${filterNotice})`);

  await page.screenshot({ path: path.join(artifactsDir, 'public_support_security_filter.png') });
  console.log('Saved public_support_security_filter.png');

  // 9. Test Live Search
  console.log('Testing live search with query: "DNS"...');
  const searchInput = await page.$('input[aria-label="Please enter your question"]');
  await searchInput.type('DNS');
  await sleep(300);

  const searchResultsCount = await page.$eval('.bg-\\[\\#FAF7F2\\] span', (el) => el.innerText.trim());
  assert(searchResultsCount.includes('DNS'), `Search notification displays query DNS (got: ${searchResultsCount})`);

  await page.screenshot({ path: path.join(artifactsDir, 'public_support_search_dns.png') });
  console.log('Saved public_support_search_dns.png');

  // Clear Search
  const clearBtn = await page.$('button[aria-label="Clear search query"]');
  if (clearBtn) {
    await clearBtn.click();
    await sleep(200);
  }

  // 10. Responsive Viewport Check at 375px
  console.log('Testing responsive viewport at 375px mobile width...');
  await page.setViewport({ width: 375, height: 812 });
  await sleep(300);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  assert(scrollWidth <= clientWidth, `No horizontal scrolling on 375px viewport (scrollWidth: ${scrollWidth}, clientWidth: ${clientWidth})`);

  await page.screenshot({ path: path.join(artifactsDir, 'public_support_mobile_375px.png') });
  console.log('Saved public_support_mobile_375px.png');

  await browser.close();
  console.log('--- ALL PUBLIC SUPPORT FAQ VERIFICATION CHECKS PASSED ---');
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
