import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { execSync } from 'child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log("=== STEP 1: STOPPING BYOS-API CONTAINER ===");
  try {
    execSync('docker stop byos-api', { stdio: 'inherit' });
  } catch (err) {
    console.error("Error stopping byos-api:", err);
  }

  console.log("\n=== STEP 2: LAUNCHING REAL CHROME HEADLESS BROWSER ===");
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Set Alice session cookie on localhost:3001
  await page.setCookie({
    name: 'byos_session',
    value: 'alice_test_session_token_1234567890',
    domain: 'localhost',
    path: '/',
    httpOnly: true,
  });

  console.log("\n=== STEP 3: NAVIGATING TO WEBMAIL (http://localhost:3001) WITH API STOPPED ===");
  try {
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle0', timeout: 15000 });
  } catch (err) {
    console.log("Navigation finished or timed out on networkidle (expected since API is unreachable):", err.message);
  }

  // Wait a few seconds for SolidJS effects to run and API calls to fail
  console.log("Waiting for SolidJS error handler and DOM update...");
  await new Promise(r => setTimeout(r, 3000));

  console.log("\n=== STEP 4: INSPECTING DOM FOR ERROR BANNER ===");
  const banner = await page.$('[data-testid="global-error-banner"]');
  if (!banner) {
    console.error("FAILURE: [data-testid=\"global-error-banner\"] NOT found in DOM!");
    const bodyHtml = await page.evaluate(() => document.body.innerHTML);
    console.log("Body HTML snippet:", bodyHtml.slice(0, 500));
    await browser.close();
    process.exit(1);
  }

  const bannerText = await page.evaluate(el => el.innerText, banner);
  const bannerRole = await page.evaluate(el => el.querySelector('[role="alert"]')?.getAttribute('role'), banner);
  console.log("SUCCESS: Global error banner is RENDERING in the DOM!");
  console.log("Raw Banner Text:", JSON.stringify(bannerText));
  console.log("Role Attribute:", bannerRole);

  const screenshotPath = 'f:\\Codex\\byos-email\\tests\\browser\\banner_error_dom.png';
  await page.screenshot({ path: screenshotPath });
  console.log("Screenshot saved to:", screenshotPath);

  console.log("\n=== STEP 5: RESTARTING BYOS-API CONTAINER ===");
  execSync('docker start byos-api', { stdio: 'inherit' });

  // Wait for API container health
  console.log("Waiting for API container to come online...");
  let apiUp = false;
  for (let i = 0; i < 15; i++) {
    try {
      execSync('curl.exe -s http://localhost:8080/health', { stdio: 'ignore' });
      apiUp = true;
      break;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log("API online status:", apiUp ? "ONLINE" : "OFFLINE");

  console.log("\n=== STEP 6: DISMISSING BANNER VIA UI BUTTON ===");
  const dismissBtn = await page.$('[data-testid="dismiss-global-error"]');
  if (dismissBtn) {
    await dismissBtn.click();
    await new Promise(r => setTimeout(r, 500));
    const bannerAfterDismiss = await page.$('[data-testid="global-error-banner"]');
    console.log("Banner present after click dismiss:", bannerAfterDismiss !== null);
  }

  console.log("\n=== STEP 7: RELOADING PAGE WITH API ONLINE ===");
  await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));

  const bannerAfterReload = await page.$('[data-testid="global-error-banner"]');
  console.log("Banner present after reload with healthy API:", bannerAfterReload !== null);

  await browser.close();
  console.log("\n=== BROWSER VERIFICATION COMPLETED SUCCESSFULLY ===");
}

run().catch(err => {
  console.error("Unhandled error in browser verification:", err);
  // Ensure API is restarted
  try { execSync('docker start byos-api'); } catch {}
  process.exit(1);
});
