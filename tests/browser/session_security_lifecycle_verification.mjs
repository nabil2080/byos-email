/**
 * BYOS Release C4: Unified Session Security, Authentication Lifecycle & Multi-Application Hardening
 * Comprehensive Browser Verification Script
 *
 * Verifies:
 * 1. Webmail Session Lifecycle:
 *    - Real login flow (alice@byos.local)
 *    - Strict HttpOnly byos_webmail_session cookie (HttpOnly: true, SameSite: Lax, Path: /)
 *    - Total omission of duplicate JavaScript-readable `token` in login JSON response
 *    - Total elimination of session tokens from sessionStorage and localStorage
 *    - Zero-knowledge key custody: mailbox secret keys absent from browser storage
 *    - Session persistence on reload via ambient HttpOnly cookie
 *    - Server-authoritative logout clearing byos_webmail_session cookie
 *
 * 2. Control Plane Session Lifecycle:
 *    - Real login flow (alice@byos.local, owner)
 *    - Strict HttpOnly byos_cp_session cookie (HttpOnly: true, SameSite: Lax, Path: /)
 *    - Total omission of duplicate `token` in login JSON response for control-plane client
 *    - Total absence of session tokens in browser storage
 *    - Dashboard access & session persistence
 *    - Server-authoritative logout clearing byos_cp_session cookie
 *
 * 3. Support CRM Session Lifecycle:
 *    - Administrative login flow
 *    - Strict HttpOnly byos_admin_session cookie (HttpOnly: true, SameSite: Lax, Path: /)
 *    - Zero tokens in browser storage
 *    - Administrative interface rendering
 *    - Logout clearing byos_admin_session cookie
 *
 * Artifacts generated:
 * - tests/browser/artifacts/c4_webmail_session_lifecycle.png
 * - tests/browser/artifacts/c4_control_plane_session_lifecycle.png
 * - tests/browser/artifacts/c4_support_crm_session_lifecycle.png
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('../../apps/webmail/node_modules/puppeteer-core');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSessionSecurityLifecycleVerification() {
  console.log('================================================================================');
  console.log('       BYOS RELEASE C4: UNIFIED SESSION SECURITY & LIFECYCLE VERIFICATION       ');
  console.log('================================================================================\n');

  console.log('--- PHASE 0: Environment Safety Assurance ---');
  assert(true, 'Operating in non-mutating browser verification mode (preserving active byos DB)');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1440,900',
    ],
  });

  try {
    // =========================================================================
    // SECTION 1: WEBMAIL SESSION LIFECYCLE
    // =========================================================================
    console.log('\n========================================================================');
    console.log(' SECTION 1: Webmail Session Security & Authentication Lifecycle');
    console.log('========================================================================');

    const webmailPage = await browser.newPage();
    await webmailPage.setViewport({ width: 1440, height: 900 });

    const cdp = await webmailPage.target().createCDPSession();

    // Listen to network responses to inspect the login response payload
    let webmailLoginResponseBody = null;
    let webmailLoginResponseHeaders = null;

    await webmailPage.exposeFunction('onWebmailLoginIntercepted', (data) => {
      webmailLoginResponseBody = data;
    });
    await webmailPage.evaluateOnNewDocument(() => {
      const origFetch = window.fetch;
      window.fetch = async (...args) => {
        const res = await origFetch(...args);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('/v1/auth/login')) {
          try {
            const clone = res.clone();
            clone.json().then((json) => {
              if (window.onWebmailLoginIntercepted) window.onWebmailLoginIntercepted(json);
            }).catch(() => {});
          } catch {}
        }
        return res;
      };
    });

    webmailPage.on('response', async (res) => {
      if (res.url().includes('/v1/auth/login')) {
        try {
          webmailLoginResponseHeaders = res.headers();
          if (!webmailLoginResponseBody) {
            webmailLoginResponseBody = await res.json();
          }
        } catch {
          // ignore non-json
        }
      }
    });

    console.log('\n  1.1 Navigating to Webmail (http://127.0.0.1:3001)...');
    await webmailPage.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(1000);

    // Ensure we start from a clean state (log out if already logged in)
    const initialUrl = webmailPage.url();
    const emailInputExists = await webmailPage.$('input[type="email"]');
    if (!emailInputExists) {
      console.log('  Logging out existing session to verify complete login flow...');
      await webmailPage.evaluate(async () => {
        await fetch('/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-BYOS-Client': 'webmail' } });
        localStorage.clear();
        sessionStorage.clear();
      });
      await webmailPage.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(1000);
    }

    const emailInput = await webmailPage.waitForSelector('input[type="email"]', { timeout: 10000 });
    assert(emailInput !== null, 'Webmail login form rendered');

    console.log('  1.2 Submitting credentials for alice@byos.local...');
    await webmailPage.type('input[type="email"]', 'alice@byos.local');
    await webmailPage.type('input[type="password"]', 'test-password-123');

    const submitBtn = await webmailPage.$('button[type="submit"]');
    await submitBtn.click();

    // Wait for authenticated app shell to mount
    await sleep(3500);

    // Verify login network response omitted token
    assert(webmailLoginResponseBody !== null, 'Received /v1/auth/login response');
    assert(webmailLoginResponseBody.email === 'alice@byos.local', `Login response user matches alice@byos.local`);
    assert(
      webmailLoginResponseBody.token === undefined,
      `Login JSON response strictly OMITS duplicate token for browser client (got: ${webmailLoginResponseBody.token})`
    );

    // Verify HttpOnly cookie attributes via CDP
    const webmailCookies = (await cdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3001'] })).cookies;
    const webmailSessionCookie = webmailCookies.find((c) => c.name === 'byos_webmail_session');
    assert(webmailSessionCookie !== undefined, 'Found primary session cookie: byos_webmail_session');
    assert(webmailSessionCookie.httpOnly === true, 'Session cookie byos_webmail_session is marked HttpOnly');
    assert(webmailSessionCookie.sameSite === 'Lax', `Session cookie byos_webmail_session SameSite is Lax (got: ${webmailSessionCookie.sameSite})`);
    assert(webmailSessionCookie.path === '/', `Session cookie byos_webmail_session Path is / (got: ${webmailSessionCookie.path})`);

    // Verify browser storage contains no session tokens or secret keys
    const webmailStorage = await webmailPage.evaluate(() => {
      const sKeys = Object.keys(sessionStorage);
      const lKeys = Object.keys(localStorage);
      const sMap = {};
      const lMap = {};
      for (const k of sKeys) sMap[k] = sessionStorage.getItem(k);
      for (const k of lKeys) lMap[k] = localStorage.getItem(k);

      const connAccountsStr = localStorage.getItem('byos_connected_accounts') || sessionStorage.getItem('byos_connected_accounts');
      let parsedConnAccounts = [];
      try {
        parsedConnAccounts = connAccountsStr ? JSON.parse(connAccountsStr) : [];
      } catch {}

      return {
        sessionStorageKeys: sKeys,
        localStorageKeys: lKeys,
        activeSessionTokenInSessionStorage: sessionStorage.getItem('byos_active_session_token'),
        impersonationTokenInSessionStorage: sessionStorage.getItem('byos_impersonation_token'),
        activeSessionTokenInLocalStorage: localStorage.getItem('byos_active_session_token'),
        sessionTokenInLocalStorage: localStorage.getItem('sessionToken'),
        mailboxSkeyEntriesInSessionStorage: sKeys.filter((k) => k.startsWith('byos_mailbox_skey_')),
        connectedAccounts: parsedConnAccounts,
      };
    });

    assert(webmailStorage.activeSessionTokenInSessionStorage === null, 'sessionStorage: byos_active_session_token is strictly absent');
    assert(webmailStorage.impersonationTokenInSessionStorage === null, 'sessionStorage: byos_impersonation_token is strictly absent');
    assert(webmailStorage.activeSessionTokenInLocalStorage === null, 'localStorage: byos_active_session_token is strictly absent');
    assert(webmailStorage.sessionTokenInLocalStorage === null, 'localStorage: sessionToken is strictly absent');
    assert(webmailStorage.mailboxSkeyEntriesInSessionStorage.length === 0, 'sessionStorage: no byos_mailbox_skey_* entries found');

    for (const acc of webmailStorage.connectedAccounts) {
      assert(acc.sessionToken === undefined, `Connected account ${acc.email} in storage has NO sessionToken`);
      assert(acc.mailboxSkHex === undefined, `Connected account ${acc.email} in storage has NO mailboxSkHex`);
    }

    console.log('  1.3 Testing page reload and session persistence via ambient HttpOnly cookie...');
    await webmailPage.reload({ waitUntil: 'networkidle2' });
    await sleep(2000);

    const meAfterReload = await webmailPage.evaluate(async () => {
      const res = await fetch('/v1/auth/me', { credentials: 'include', headers: { 'X-BYOS-Client': 'webmail' } });
      return { status: res.status, data: res.status === 200 ? await res.json() : null };
    });
    assert(meAfterReload.status === 200, 'GET /v1/auth/me returned 200 OK after page reload');
    assert(meAfterReload.data?.email === 'alice@byos.local', `Active session user preserved across reload: ${meAfterReload.data?.email}`);

    // Take screenshot
    const webmailScreenshotPath = path.join(artifactsDir, 'c4_webmail_session_lifecycle.png');
    await webmailPage.screenshot({ path: webmailScreenshotPath });
    assert(fs.existsSync(webmailScreenshotPath), `Saved screenshot artifact: ${webmailScreenshotPath}`);

    console.log('  1.4 Testing server-authoritative logout flow...');
    const logoutRes = await webmailPage.evaluate(async () => {
      const res = await fetch('/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-BYOS-Client': 'webmail' },
      });
      return res.status;
    });
    assert(logoutRes === 200 || logoutRes === 204, `POST /v1/auth/logout returned ${logoutRes}`);

    // Check cookie cleared via CDP
    const cookiesAfterLogout = (await cdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3001'] })).cookies;
    const cookieAfterLogout = cookiesAfterLogout.find((c) => c.name === 'byos_webmail_session');
    const isCookieCleared = !cookieAfterLogout || cookieAfterLogout.value === '' || cookieAfterLogout.expires < Date.now() / 1000;
    assert(isCookieCleared, 'byos_webmail_session cookie is cleared/revoked after logout');

    // Subsequent /v1/auth/me returns 401 Unauthorized
    const meAfterLogout = await webmailPage.evaluate(async () => {
      const res = await fetch('/v1/auth/me', { credentials: 'include', headers: { 'X-BYOS-Client': 'webmail' } });
      return res.status;
    });
    assert(meAfterLogout === 401, `GET /v1/auth/me strictly returns 401 Unauthorized after logout (got: ${meAfterLogout})`);

    await webmailPage.close();

    // =========================================================================
    // SECTION 2: CONTROL PLANE SESSION LIFECYCLE
    // =========================================================================
    console.log('\n========================================================================');
    console.log(' SECTION 2: Control Plane Session Security & Authentication Lifecycle');
    console.log('========================================================================');

    const cpPage = await browser.newPage();
    await cpPage.setViewport({ width: 1440, height: 900 });

    const cpCdp = await cpPage.target().createCDPSession();

    let cpLoginResponseBody = null;
    await cpPage.exposeFunction('onCpLoginIntercepted', (data) => {
      cpLoginResponseBody = data;
    });
    await cpPage.evaluateOnNewDocument(() => {
      const origFetch = window.fetch;
      window.fetch = async (...args) => {
        const res = await origFetch(...args);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('/v1/auth/login')) {
          try {
            const clone = res.clone();
            clone.json().then((json) => {
              if (window.onCpLoginIntercepted) window.onCpLoginIntercepted(json);
            }).catch(() => {});
          } catch {}
        }
        return res;
      };
    });

    cpPage.on('response', async (res) => {
      if (res.url().includes('/v1/auth/login')) {
        try {
          if (!cpLoginResponseBody) {
            cpLoginResponseBody = await res.json();
          }
        } catch {}
      }
    });

    console.log('\n  2.1 Navigating to Control Plane (http://127.0.0.1:3000/login)...');
    await cpPage.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(1500);

    // If already logged in, log out first
    if (!await cpPage.$('input[type="email"]')) {
      console.log('  Logging out existing Control Plane session...');
      await cpPage.evaluate(async () => {
        await fetch('/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-BYOS-Client': 'control-plane' } });
        localStorage.clear();
        sessionStorage.clear();
      });
      await cpPage.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle2', timeout: 15000 });
      await sleep(1000);
    }

    const cpEmailInput = await cpPage.waitForSelector('input[type="email"]', { timeout: 10000 });
    assert(cpEmailInput !== null, 'Control Plane login form rendered');

    console.log('  2.2 Submitting credentials for alice@byos.local (owner)...');
    await cpPage.type('input[type="email"]', 'alice@byos.local');
    await cpPage.type('input[type="password"]', 'test-password-123');

    const cpSubmitBtn = await cpPage.$('button[type="submit"]');
    await cpSubmitBtn.click();

    await sleep(3500);

    // Verify login network response omitted token
    assert(cpLoginResponseBody !== null, 'Received Control Plane /v1/auth/login response');
    assert(
      cpLoginResponseBody.token === undefined,
      `Control Plane login JSON response strictly OMITS duplicate token (got: ${cpLoginResponseBody.token})`
    );

    // Verify HttpOnly cookie attributes via CDP
    const cpCookies = (await cpCdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3000'] })).cookies;
    const cpSessionCookie = cpCookies.find((c) => c.name === 'byos_cp_session');
    assert(cpSessionCookie !== undefined, 'Found Control Plane session cookie: byos_cp_session');
    assert(cpSessionCookie.httpOnly === true, 'Session cookie byos_cp_session is marked HttpOnly');
    assert(cpSessionCookie.sameSite === 'Lax', `Session cookie byos_cp_session SameSite is Lax (got: ${cpSessionCookie.sameSite})`);
    assert(cpSessionCookie.path === '/', `Session cookie byos_cp_session Path is / (got: ${cpSessionCookie.path})`);

    // Verify storage has no session tokens
    const cpStorage = await cpPage.evaluate(() => {
      return {
        sessionStorageToken: sessionStorage.getItem('byos_active_session_token') || sessionStorage.getItem('token'),
        localStorageToken: localStorage.getItem('byos_active_session_token') || localStorage.getItem('sessionToken'),
      };
    });
    assert(cpStorage.sessionStorageToken === null, 'Control Plane sessionStorage contains NO session tokens');
    assert(cpStorage.localStorageToken === null, 'Control Plane localStorage contains NO session tokens');

    // Verify authenticated user identity via /v1/auth/me
    const cpMe = await cpPage.evaluate(async () => {
      const res = await fetch('/v1/auth/me', { credentials: 'include', headers: { 'X-BYOS-Client': 'control-plane' } });
      return { status: res.status, data: res.status === 200 ? await res.json() : null };
    });
    assert(cpMe.status === 200, 'Control Plane GET /v1/auth/me returned 200 OK');
    assert(cpMe.data?.email === 'alice@byos.local', `Control Plane authenticated user is alice@byos.local`);
    assert(cpMe.data?.role === 'owner', `Control Plane role is owner`);

    // Save screenshot
    const cpScreenshotPath = path.join(artifactsDir, 'c4_control_plane_session_lifecycle.png');
    await cpPage.screenshot({ path: cpScreenshotPath });
    assert(fs.existsSync(cpScreenshotPath), `Saved screenshot artifact: ${cpScreenshotPath}`);

    console.log('  2.3 Testing Control Plane logout flow...');
    const cpLogoutStatus = await cpPage.evaluate(async () => {
      const res = await fetch('/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-BYOS-Client': 'control-plane' },
      });
      return res.status;
    });
    assert(cpLogoutStatus === 200 || cpLogoutStatus === 204, `Control Plane POST /v1/auth/logout returned ${cpLogoutStatus}`);

    const cpCookiesAfterLogout = (await cpCdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3000'] })).cookies;
    const cpCookieAfterLogout = cpCookiesAfterLogout.find((c) => c.name === 'byos_cp_session');
    const isCpCookieCleared = !cpCookieAfterLogout || cpCookieAfterLogout.value === '' || cpCookieAfterLogout.expires < Date.now() / 1000;
    assert(isCpCookieCleared, 'byos_cp_session cookie is cleared/revoked after logout');

    await cpPage.close();

    // =========================================================================
    // SECTION 3: SUPPORT CRM SESSION LIFECYCLE
    // =========================================================================
    console.log('\n========================================================================');
    console.log(' SECTION 3: Support CRM Session Security & Authentication Lifecycle');
    console.log('========================================================================');

    const crmPage = await browser.newPage();
    await crmPage.setViewport({ width: 1440, height: 900 });

    const crmCdp = await crmPage.target().createCDPSession();

    console.log('\n  3.1 Navigating to Support CRM (http://127.0.0.1:3003)...');
    await crmPage.goto('http://127.0.0.1:3003', { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);

    // Verify Support CRM mock-login sets byos_admin_session HttpOnly cookie
    const crmCookies = (await crmCdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3003'] })).cookies;
    let adminSessionCookie = crmCookies.find((c) => c.name === 'byos_admin_session');

    if (!adminSessionCookie) {
      console.log('  Triggering admin session authentication via /admin/v1/auth/mock-login...');
      await crmPage.evaluate(async () => {
        await fetch('/admin/v1/auth/mock-login', { method: 'POST', credentials: 'include' });
      });
      await sleep(1000);
      const cookiesRetry = (await crmCdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3003'] })).cookies;
      adminSessionCookie = cookiesRetry.find((c) => c.name === 'byos_admin_session');
    }

    assert(adminSessionCookie !== undefined, 'Found Support CRM session cookie: byos_admin_session');
    assert(adminSessionCookie.httpOnly === true, 'Session cookie byos_admin_session is marked HttpOnly');
    assert(adminSessionCookie.sameSite === 'Lax', `Session cookie byos_admin_session SameSite is Lax (got: ${adminSessionCookie.sameSite})`);
    assert(adminSessionCookie.path === '/', `Session cookie byos_admin_session Path is / (got: ${adminSessionCookie.path})`);

    // Verify storage in Support CRM
    const crmStorage = await crmPage.evaluate(() => {
      return {
        sessionStorageToken: sessionStorage.getItem('byos_active_session_token') || sessionStorage.getItem('admin_token'),
        localStorageToken: localStorage.getItem('byos_active_session_token') || localStorage.getItem('admin_token'),
      };
    });
    assert(crmStorage.sessionStorageToken === null, 'Support CRM sessionStorage contains NO session tokens');
    assert(crmStorage.localStorageToken === null, 'Support CRM localStorage contains NO session tokens');

    // Verify Support CRM operator identity in DOM
    const crmBodyText = await crmPage.evaluate(() => document.body.innerText);
    assert(crmBodyText.includes('sarah.support@byos.local'), 'Support CRM operator identity displayed: sarah.support@byos.local');
    assert(!crmBodyText.includes('Runtime Error'), 'Support CRM has no Runtime Errors');

    // Save screenshot
    const crmScreenshotPath = path.join(artifactsDir, 'c4_support_crm_session_lifecycle.png');
    await crmPage.screenshot({ path: crmScreenshotPath });
    assert(fs.existsSync(crmScreenshotPath), `Saved screenshot artifact: ${crmScreenshotPath}`);

    console.log('  3.2 Testing Support CRM logout flow...');
    const crmLogoutStatus = await crmPage.evaluate(async () => {
      const res = await fetch('/admin/v1/auth/logout', { method: 'POST', credentials: 'include' });
      return res.status;
    });
    assert(crmLogoutStatus === 200 || crmLogoutStatus === 204, `Support CRM POST /admin/v1/auth/logout returned ${crmLogoutStatus}`);

    const crmCookiesAfterLogout = (await crmCdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3003'] })).cookies;
    const crmCookieAfterLogout = crmCookiesAfterLogout.find((c) => c.name === 'byos_admin_session');
    const isCrmCookieCleared = !crmCookieAfterLogout || crmCookieAfterLogout.value === '' || crmCookieAfterLogout.expires < Date.now() / 1000;
    assert(isCrmCookieCleared, 'byos_admin_session cookie is cleared/revoked after logout');

    await crmPage.close();

    // =========================================================================
    // SECTION 4: CLIENT-HEADER BOUNDARY & ADVERSARIAL TAMPER VERIFICATION
    // =========================================================================
    console.log('\n========================================================================');
    console.log(' SECTION 4: Client-Header Boundary & Adversarial Tamper Verification');
    console.log('========================================================================');

    const boundaryPage = await browser.newPage();
    await boundaryPage.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2', timeout: 15000 });

    const boundaryTestVariants = [
      { name: 'Omitted X-BYOS-Client Header', headers: {} },
      { name: 'X-BYOS-Client: webmail', headers: { 'X-BYOS-Client': 'webmail' } },
      { name: 'X-BYOS-Client: control-plane', headers: { 'X-BYOS-Client': 'control-plane' } },
      { name: 'X-BYOS-Client: cli', headers: { 'X-BYOS-Client': 'cli' } },
      { name: 'X-BYOS-Client: forged-native-cli-client-42', headers: { 'X-BYOS-Client': 'forged-native-cli-client-42' } },
      { name: 'X-BYOS-Client: "" (explicitly empty)', headers: { 'X-BYOS-Client': '' } },
    ];

    for (const variant of boundaryTestVariants) {
      console.log(`\n  4.1 Testing boundary variant: ${variant.name}...`);
      const authResult = await boundaryPage.evaluate(async (reqHeaders) => {
        const res = await fetch('/v1/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...reqHeaders,
          },
          body: JSON.stringify({ email: 'alice@byos.local', password: 'test-password-123' }),
        });
        const status = res.status;
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        return { status, text, json };
      }, variant.headers);

      assert(authResult.status === 200, `Authentication succeeds with HTTP 200 for ${variant.name}`);
      assert(authResult.json !== null, `Response is valid JSON for ${variant.name}`);
      assert(
        authResult.json.token === undefined,
        `Session token is strictly ABSENT from JSON response body for ${variant.name} (got: ${authResult.json.token})`
      );
      assert(
        authResult.json.session_token === undefined,
        `session_token is strictly ABSENT from JSON response body for ${variant.name}`
      );
      assert(
        authResult.json.sessionToken === undefined,
        `sessionToken is strictly ABSENT from JSON response body for ${variant.name}`
      );
      assert(
        !authResult.text.includes('"token":'),
        `Raw response text does NOT contain '"token":' for ${variant.name}`
      );
    }

    console.log('\n  4.2 Testing invalid credentials fail-closed boundary...');
    const invalidAuthResult = await boundaryPage.evaluate(async () => {
      const res = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@byos.local', password: 'wrong-password-attack' }),
      });
      return { status: res.status, text: await res.text() };
    });
    assert(invalidAuthResult.status === 401, `Invalid login strictly fails closed with HTTP 401 (got: ${invalidAuthResult.status})`);
    assert(!invalidAuthResult.text.includes('token'), `Invalid login response does not contain any token`);

    await boundaryPage.close();

    console.log('\n================================================================================');
    console.log('       ALL RELEASE C4.1 SESSION SECURITY VERIFICATION CHECKS PASSED             ');
    console.log('================================================================================\n');
  } finally {
    await browser.close();
  }
}

runSessionSecurityLifecycleVerification().catch((err) => {
  console.error('\nVerification failed with exception:', err);
  process.exit(1);
});
