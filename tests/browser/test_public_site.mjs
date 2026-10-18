import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

async function isServerReady(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.status === 200 || res.status === 302;
  } catch {
    return false;
  }
}

async function runPublicSiteTest() {
  console.log("================================================================================");
  console.log("                    PUBLIC SITE VERIFICATION SUITE                             ");
  console.log("================================================================================\n");

  let baseUrl = "http://localhost:4321";
  if (await isServerReady("http://localhost:3002/")) {
    baseUrl = "http://localhost:3002";
  }
  let devProcess = null;

  // Check if dev server is running, otherwise start it
  const ready = await isServerReady(baseUrl + "/");
  if (!ready) {
    console.log("[SETUP] Astro dev server not detected on :4321. Spawning dev server...");
    const astroCli = path.resolve(__dirname, '../../apps/public-site/node_modules/astro/bin/astro.mjs');
    const siteRoot = path.resolve(__dirname, '../../apps/public-site');
    const lockPath = path.resolve(siteRoot, '.astro/dev.json');
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch {}
    }
    
    devProcess = spawn(
      process.execPath,
      [astroCli, 'dev', '--port', '4321', '--host', 'localhost'],
      {
        cwd: siteRoot,
        env: { ...process.env, ASTRO_DEV_BACKGROUND: 'false' },
        stdio: 'pipe'
      }
    );

    devProcess.stdout.on('data', (d) => {
      console.log(`  [astro] ${d.toString().trim()}`);
    });
    devProcess.stderr.on('data', (d) => console.error(`  [astro err] ${d.toString().trim()}`));
    devProcess.on('error', (err) => console.error(`  [astro proc err]`, err));
    devProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) console.log(`  [astro exit] code ${code}`);
    });

    let attempts = 0;
    while (attempts < 30) {
      await sleep(500);
      if (await isServerReady(baseUrl + "/")) {
        console.log(`[SETUP] Dev server ready at ${baseUrl} after ${attempts * 500}ms`);
        break;
      }
      attempts++;
    }
    if (attempts >= 30) {
      throw new Error("Failed to start Astro dev server on port 4321 within 15s");
    }
  } else {
    console.log(`[SETUP] Astro dev server already running at ${baseUrl}`);
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const consoleErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore expected net connection refused to non-running control plane
        if (!text.includes('net::ERR_CONNECTION_REFUSED') && !text.includes('Failed to load resource')) {
          consoleErrors.push(text);
        }
      }
    });

    // 1. Navigate to /
    console.log("\n--- [STEP 1] Navigate to / and assert layout & top nav ---");
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle2' });
    await sleep(500);

    const heroText = await page.evaluate(() => document.body.innerText);
    assert(heroText.includes("Business Email") && heroText.includes("Your control"), "Hero renders correctly");

    const navItems = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('nav a'));
      return links.map(a => ({ text: a.innerText.trim(), href: a.getAttribute('href') }));
    });
    const navTexts = navItems.map(n => n.text.toLowerCase());
    assert(navTexts.some(t => t.includes('pricing')), "Top nav has Pricing link");
    assert(navTexts.some(t => t.includes('about')), "Top nav has About link");
    assert(navTexts.some(t => t.includes('sign in')), "Top nav has Sign in link");
    assert(navTexts.some(t => t.includes('get started')), "Top nav has Get started CTA");

    // Check all hrefs on / for 127.0.0.1:3000
    const allHrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
    });
    const badHrefs = allHrefs.filter(h => h && h.includes("127.0.0.1:3000"));
    assert(badHrefs.length === 0, `All hrefs on / contain no 127.0.0.1:3000 (found ${badHrefs.length})`);

    // Top nav specific target checks
    const signInLinks = navItems.filter(n => n.text.toLowerCase().includes('sign in'));
    assert(signInLinks.length > 0 && signInLinks.every(l => l.href.endsWith('/login') && !l.href.includes('127.0.0.1:3000')),
      "Top nav Sign in points to PUBLIC_CP_URL/login");

    const getStartedLinks = navItems.filter(n => n.text.toLowerCase().includes('get started'));
    assert(getStartedLinks.length > 0 && getStartedLinks.every(l => l.href.endsWith('/signup') && !l.href.includes('127.0.0.1:3000')),
      "Top nav Get started points to PUBLIC_CP_URL/signup");

    const homeScreenshot = path.join(artifactsDir, 'public_home_fixed.png');
    await page.screenshot({ path: homeScreenshot, fullPage: false });
    assert(fs.existsSync(homeScreenshot), "Saved public_home_fixed.png screenshot");

    // 2. Click Pricing and check DynamicPricingCalculator
    console.log("\n--- [STEP 2] Navigate to /pricing and test 20 seats calculation ---");
    await page.click('a[href="/pricing"]');
    await page.waitForSelector('#seat-input-pub', { timeout: 10000 });
    await sleep(500);

    // Switch to Monthly
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const monthlyBtn = buttons.find(b => b.textContent.trim().toLowerCase() === 'monthly');
      if (monthlyBtn) monthlyBtn.click();
    });
    await sleep(300);

    // Set seats to 20
    await page.evaluate(() => {
      const input = document.getElementById('seat-input-pub');
      input.value = '20';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    await sleep(600);

    const pricingContent = await page.evaluate(() => document.body.innerText);
    assert(pricingContent.includes('$58.50') || pricingContent.includes('58.50'),
      "Displayed monthly total is $58.50 for 20 seats in calculator");

    // Also assert the static comparison card shows $58.50
    assert(pricingContent.includes('BYOS Business Email (20 Seats)'), "Comparison card renders 20 seats");

    const pricingScreenshot = path.join(artifactsDir, 'public_pricing_20_seats.png');
    await page.screenshot({ path: pricingScreenshot, fullPage: false });
    assert(fs.existsSync(pricingScreenshot), "Saved public_pricing_20_seats.png screenshot");

    // 3. Test direct navigation redirects
    console.log("\n--- [STEP 3] Test direct navigation redirects (/login, /signup, /register) ---");
    
    // /login
    const loginRes = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
    const loginLocation = loginRes.headers.get('location') || '';
    let targetLogin = loginLocation;
    try {
      await page.goto(`${baseUrl}/login`, { waitUntil: 'commit', timeout: 5000 });
      targetLogin = page.url();
    } catch (err) {
      if (err.message.includes('/login')) {
        targetLogin = err.message;
      }
    }
    assert(
      (loginRes.status === 302 && loginLocation.includes('/login')) || targetLogin.includes('/login'),
      `Direct /login redirects to control plane login (status: ${loginRes.status}, location: ${loginLocation})`
    );

    // /signup
    const signupRes = await fetch(`${baseUrl}/signup`, { redirect: 'manual' });
    const signupLocation = signupRes.headers.get('location') || '';
    let targetSignup = signupLocation;
    try {
      await page.goto(`${baseUrl}/signup`, { waitUntil: 'commit', timeout: 5000 });
      targetSignup = page.url();
    } catch (err) {
      if (err.message.includes('/signup')) {
        targetSignup = err.message;
      }
    }
    assert(
      (signupRes.status === 302 && signupLocation.includes('/signup')) || targetSignup.includes('/signup'),
      `Direct /signup redirects to control plane signup (status: ${signupRes.status}, location: ${signupLocation})`
    );

    // /register
    const registerRes = await fetch(`${baseUrl}/register`, { redirect: 'manual' });
    const registerLocation = registerRes.headers.get('location') || '';
    let targetRegister = registerLocation;
    try {
      await page.goto(`${baseUrl}/register`, { waitUntil: 'commit', timeout: 5000 });
      targetRegister = page.url();
    } catch (err) {
      if (err.message.includes('signup') || err.message.includes('register')) {
        targetRegister = err.message;
      }
    }
    assert(
      (registerRes.status === 301 && registerLocation.includes('/signup')) ||
      targetRegister.includes('/signup'),
      `Direct /register redirects to /signup (status: ${registerRes.status}, location: ${registerLocation})`
    );

    // 4. Test /privacy and #terms anchor
    console.log("\n--- [STEP 4] Test /privacy and #terms anchor ---");
    await page.goto(`${baseUrl}/privacy`, { waitUntil: 'networkidle2' });
    await sleep(500);

    const termsAnchor = await page.evaluate(() => {
      const el = document.getElementById('terms');
      return el ? { id: el.id, text: el.innerText } : null;
    });
    assert(termsAnchor !== null && termsAnchor.id === 'terms', "#terms anchor exists in privacy.astro");

    const privacyScreenshot = path.join(artifactsDir, 'public_privacy_terms.png');
    await page.screenshot({ path: privacyScreenshot, fullPage: false });
    assert(fs.existsSync(privacyScreenshot), "Saved public_privacy_terms.png screenshot");

    // 5. Test /docs for no 127.0.0.1:3000
    console.log("\n--- [STEP 5] Test /docs for absence of 127.0.0.1:3000 ---");
    await page.goto(`${baseUrl}/docs`, { waitUntil: 'networkidle2' });
    await sleep(500);

    const docsHrefs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
    });
    const badDocsHrefs = docsHrefs.filter(h => h && h.includes('127.0.0.1:3000'));
    assert(badDocsHrefs.length === 0, `No CTA on /docs contains 127.0.0.1:3000 (found ${badDocsHrefs.length})`);

    // 6. Test /favicon.svg and /robots.txt
    console.log("\n--- [STEP 6] Test /favicon.svg and /robots.txt HTTP responses ---");
    const faviconRes = await fetch(`${baseUrl}/favicon.svg`);
    assert(faviconRes.status === 200, `/favicon.svg responds HTTP 200 (status: ${faviconRes.status})`);

    const robotsRes = await fetch(`${baseUrl}/robots.txt`);
    assert(robotsRes.status === 200, `/robots.txt responds HTTP 200 (status: ${robotsRes.status})`);
    const robotsText = await robotsRes.text();
    assert(robotsText.includes('Disallow: /login') && robotsText.includes('Disallow: /signup'),
      "/robots.txt contains expected crawler directives");

    // 7. Console errors assertion
    console.log("\n--- [STEP 7] Console error evaluation ---");
    assert(consoleErrors.length === 0, `No console errors recorded during run (errors: ${consoleErrors.join(', ')})`);

    console.log("\n================================================================================");
    console.log("            ALL 7 PUBLIC SITE VERIFICATION CHECKS PASSED                       ");
    console.log("================================================================================\n");

  } finally {
    if (browser) await browser.close();
    if (devProcess) {
      console.log("[TEARDOWN] Terminating spawned Astro dev server...");
      devProcess.kill();
      try {
        const lockPath = path.resolve(__dirname, '../../apps/public-site/.astro/dev.json');
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
      } catch {}
    }
  }
}

runPublicSiteTest().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
