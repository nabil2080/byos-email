import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.join(ROOT, 'scratch');
const ARTIFACTS_DIR = path.join(__dirname, 'artifacts');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const PG_HOST_PORT = 55432;
const REDIS_PORT = 56379;
const MINIO_URL = 'http://127.0.0.1:9000';
const MINIO_ACCESS = 'byosminio';
const MINIO_SECRET = 'byosminio_dev_password';
const BUCKET = 'byos-relb-e2e';
const API_PORT = 18090;
const STORAGE_PORT = 18091;
const SMTP_PORT = 12525;
const VITE_PORT = 13001;

const STORAGE_INTERNAL_KEY = 'relb-e2e-storage-internal-key';
const OUTBOUND_INTERNAL_KEY = 'relb-e2e-outbound-internal-key';
const JWT_SECRET = 'relb-e2e-jwt-secret-0123456789abcdef';

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  PASS: ${msg}`);
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'byos_relb_pg', 'psql', '-U', 'byos', '-d', 'byos_test', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

function psqlScript(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'byos_relb_pg', 'psql', '-U', 'byos', '-d', 'byos_test', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  );
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function encryptDkimPem(dek, pem) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from('dkim-private-key-v1', 'utf8'));
  const ct = Buffer.concat([cipher.update(Buffer.from(pem, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([0x01]), iv, ct, tag]);
}

async function computeOutboundKeyIdHex(pkBytes) {
  return sha256Buf(Buffer.concat([Buffer.from('byos-outbound-pk-v1', 'utf8'), pkBytes]))
    .subarray(0, 8)
    .toString('hex');
}

function startSmtpCaptureServer(port) {
  const captured = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let inData = false;
    let mailFrom = '';
    let rcptTo = [];
    let dataChunks = [];
    socket.write('220 relb-browser-smtp.local ESMTP\r\n');
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const idx = buf.indexOf('\n');
        if (idx === -1) break;
        const lineBuf = buf.subarray(0, idx + 1);
        buf = buf.subarray(idx + 1);
        if (inData) {
          const lineStr = lineBuf.toString('latin1');
          if (lineStr === '.\r\n' || lineStr === '.\n') {
            inData = false;
            const rawData = Buffer.concat(dataChunks).toString('utf8');
            captured.push({ mailFrom, rcptTo: [...rcptTo], rawData });
            dataChunks = [];
            rcptTo = [];
            socket.write('250 2.0.0 OK queued\r\n');
          } else if (lineBuf[0] === 0x2e && lineBuf[1] === 0x2e) {
            dataChunks.push(lineBuf.subarray(1));
          } else {
            dataChunks.push(lineBuf);
          }
          continue;
        }
        const line = lineBuf.toString('utf8').trim();
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-relb-browser-smtp.local\r\n250 8BITMIME\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          mailFrom = line.slice(10).trim();
          socket.write('250 2.1.0 OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          rcptTo.push(line.slice(8).trim());
          socket.write('250 2.1.5 OK\r\n');
        } else if (upper === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '0.0.0.0', () => resolve({ server, captured }));
  });
}

async function waitFor(fn, desc, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for: ${desc}`);
}

function parseMimeTree(raw) {
  const sep = raw.indexOf('\r\n\r\n');
  const headerRaw = raw.slice(0, sep);
  const bodyRaw = raw.slice(sep + 4);
  const headers = headerRaw.split('\r\n');
  const ctHeader = headers.find((h) => h.toLowerCase().startsWith('content-type:')) || '';
  const bMatch = ctHeader.match(/boundary="([^"]+)"/i);
  if (!bMatch) return { headers, body: bodyRaw, parts: [] };
  const boundary = bMatch[1];
  const segments = bodyRaw.split(`--${boundary}`);
  const parts = [];
  for (const seg of segments.slice(1)) {
    if (seg.startsWith('--')) break;
    const trimmed = seg.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const pSep = trimmed.indexOf('\r\n\r\n');
    if (pSep === -1) continue;
    parts.push({
      headersRaw: trimmed.slice(0, pSep),
      body: trimmed.slice(pSep + 4),
    });
  }
  return { headers, body: bodyRaw, parts };
}

function generateX25519KeypairB64() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pk = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const sk = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
  return {
    public_key: pk.toString('base64'),
    private_key: sk.toString('base64'),
  };
}

async function main() {
  console.log('=== Release B Browser Verification (Real Login + Compose + v2 Attach + Send + Outbound SMTP) ===');

  const seedSql = fs
    .readFileSync(path.join(SCRATCH, 'seed_pair.sql'), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/INSERT INTO mailbox_storage[\s\S]*?ON CONFLICT DO NOTHING;/g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('DELETE FROM org_recovery_principals'))
    .join('\n');
  psql(`
    TRUNCATE outbound_delivery_attachments, outbound_queue, outbound_reservations, scheduled_messages,
             draft_attachments, drafts, attachments, message_metadata, delivery_log, aliases, sessions, mailboxes, domains, organizations, users CASCADE;
  `);
  psqlScript(seedSql);

  // Add DKIM key + rate limits to byos.local domain so outbound-worker can DKIM-sign & send externally
  const dkimDek = crypto.randomBytes(32);
  const { privateKey: dkimPrivPem, publicKey: dkimPubPem } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const dkimEncHex = encryptDkimPem(dkimDek, dkimPrivPem).toString('hex');
  psql(`
    UPDATE domains
    SET dkim_selector = 'byos',
        dkim_private_key_enc = decode('${dkimEncHex}', 'hex'),
        dkim_public_key = '${dkimPubPem.replace(/'/g, "''")}'
    WHERE name = 'byos.local';
    INSERT INTO rate_limits (plan_name, scope, time_window, limit_value) VALUES
      ('solo', 'mailbox', 'minute', 500),
      ('solo', 'mailbox', 'hour', 5000),
      ('solo', 'mailbox', 'day', 50000),
      ('solo', 'org', 'minute', 1000),
      ('solo', 'org', 'hour', 10000),
      ('solo', 'org', 'day', 100000)
    ON CONFLICT DO NOTHING;
  `);

  const ep = generateX25519KeypairB64();
  const keyId = await computeOutboundKeyIdHex(Buffer.from(ep.public_key, 'base64'));
  const pkRingPath = path.join(SCRATCH, 'relb_browser_pk_ring.json');
  const skRingPath = path.join(SCRATCH, 'relb_browser_sk_ring.json');
  fs.writeFileSync(
    pkRingPath,
    JSON.stringify({
      min_accepted_epoch: 1,
      keys: [{ key_epoch: 1, key_id: keyId, pk_b64: ep.public_key, status: 'active' }],
    }),
  );
  fs.writeFileSync(
    skRingPath,
    JSON.stringify({
      keys: [{ key_epoch: 1, key_id: keyId, sk_b64: ep.private_key, status: 'active' }],
    }),
  );

  const { server: smtpSrv, captured: smtpMessages } = await startSmtpCaptureServer(SMTP_PORT);
  const procs = [];
  const workerContainerName = 'relb_browser_worker_' + Date.now();
  let browser;
  let page;
  const consoleErrors = [];
  const networkEvents = [];

  const cleanup = () => {
    try {
      execFileSync('docker', ['rm', '-f', workerContainerName], { stdio: 'ignore' });
    } catch {}
    for (const p of procs) {
      try {
        if (process.platform === 'win32' && p.pid) {
          execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          p.kill('SIGKILL');
        }
      } catch {}
    }
    try {
      smtpSrv.closeAllConnections?.();
      smtpSrv.close();
    } catch {}
  };
  process.on('exit', cleanup);

  try {
    const dbUrlHost = `postgres://byos:byos_dev_password@127.0.0.1:${PG_HOST_PORT}/byos_test?sslmode=disable`;
    const storageProc = spawn(path.join(SCRATCH, 'storage-worker.exe'), [], {
      env: {
        ...process.env,
        STORAGE_WORKER_PORT: String(STORAGE_PORT),
        DATABASE_URL: dbUrlHost,
        MINIO_ENDPOINT: '127.0.0.1:9000',
        MINIO_ACCESS_KEY: MINIO_ACCESS,
        MINIO_SECRET_KEY: MINIO_SECRET,
        MINIO_BUCKET: BUCKET,
        STORAGE_WORKER_INTERNAL_KEY: STORAGE_INTERNAL_KEY,
      },
    });
    procs.push(storageProc);

    const apiProc = spawn(path.join(SCRATCH, 'byos-api.exe'), [], {
      env: {
        ...process.env,
        API_PORT: String(API_PORT),
        DATABASE_URL: dbUrlHost,
        REDIS_ADDR: `127.0.0.1:${REDIS_PORT}`,
        STORAGE_WORKER_URL: `http://127.0.0.1:${STORAGE_PORT}`,
        STORAGE_WORKER_INTERNAL_KEY: STORAGE_INTERNAL_KEY,
        INTERNAL_API_KEY: OUTBOUND_INTERNAL_KEY,
        JWT_SECRET,
        OUTBOUND_DELIVERY_PK_RING_FILE: pkRingPath,
        CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${VITE_PORT}`,
      },
    });
    procs.push(apiProc);
    apiProc.stderr?.on('data', (d) => process.stderr.write(`[byos-api] ${d}`));

    await waitFor(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${STORAGE_PORT}/health`);
        return r.ok;
      } catch {
        return false;
      }
    }, 'storage-worker health');
    await waitFor(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${API_PORT}/health`);
        return r.ok;
      } catch {
        return false;
      }
    }, 'byos-api health');

    const workerProc = spawn('docker', [
      'run',
      '--rm',
      '--name',
      workerContainerName,
      '--add-host=host.docker.internal:host-gateway',
      '-v',
      `${ROOT.replace(/\\/g, '/')}:/workspace`,
      '-v',
      'relb_rust_target:/target_cache',
      '-e',
      `DATABASE_URL=postgres://outbound_worker_login:outbound_worker_dev_pass@host.docker.internal:${PG_HOST_PORT}/byos_test?sslmode=disable`,
      '-e',
      `REDIS_ADDR=host.docker.internal:${REDIS_PORT}`,
      '-e',
      `BYOS_API_ADDR=host.docker.internal:${API_PORT}`,
      '-e',
      `INTERNAL_API_KEY=${OUTBOUND_INTERNAL_KEY}`,
      '-e',
      'OUTBOUND_DELIVERY_SK_RING_FILE=/workspace/scratch/relb_browser_sk_ring.json',
      '-e',
      `OUTBOUND_DELIVERY_SK_B64=${ep.private_key}`,
      '-e',
      `BYOS_DKIM_DEK_B64=${dkimDek.toString('base64')}`,
      '-e',
      `POSTFIX_ADDR=host.docker.internal:${SMTP_PORT}`,
      '-e',
      'POLL_INTERVAL_MS=200',
      '-e',
      'RUST_LOG=info',
      'rustlang/rust:nightly-slim',
      '/target_cache/debug/byos-outbound-worker',
    ]);
    procs.push(workerProc);

    const viteProc = spawn(
      'cmd.exe',
      ['/c', `npx.cmd vite --port ${VITE_PORT} --strictPort`],
      {
        cwd: path.join(ROOT, 'apps/webmail'),
        env: {
          ...process.env,
          VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
        },
      },
    );
    procs.push(viteProc);

    await waitFor(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${VITE_PORT}/`);
        return r.ok;
      } catch {
        return false;
      }
    }, 'vite dev server');

    // Create sample attachment file for browser upload
    const sampleFilename = 'relb_browser_sample_Ω.txt';
    const samplePath = path.join(ARTIFACTS_DIR, sampleFilename);
    const sampleContent = Buffer.from('Release B Browser E2E Attachment Payload — Unicode Ω 日本語\n', 'utf8');
    fs.writeFileSync(samplePath, sampleContent);

    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const pageInstance = await browser.newPage();
    page = pageInstance;
    await page.setViewport({ width: 1280, height: 850 });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
      console.error('  [PAGEERROR]', err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`  [CONSOLE ${msg.type()}] ${msg.text()}`);
      }
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/v1/')) {
        let bodyText = '';
        try {
          bodyText = await res.text();
        } catch {}
        networkEvents.push({
          method: res.request().method(),
          url,
          status: res.status(),
          bodyPreview: bodyText.slice(0, 300),
        });
      }
    });

    await page.goto(`http://127.0.0.1:${VITE_PORT}/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 20000 });
    assert(true, 'Logged in as alice@byos.local via real login flow');

    await new Promise((r) => setTimeout(r, 800));
    await page.click('[data-testid="sidebar-compose-btn"]');
    await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.waitForSelector('[data-testid="toggle-cc-bcc-btn"]', { timeout: 5000 });
    await page.$eval('[data-testid="toggle-cc-bcc-btn"]', (el) => el.click());
    await page.waitForSelector('input[placeholder="cc@example.com"]', { timeout: 5000 });

    await page.type('#composeToInput', 'external-browser@example.net');
    await page.type('input[placeholder="cc@example.com"]', 'cc-browser@example.net');
    await page.type('input[placeholder="bcc@example.com"]', 'bcc-browser@example.net');
    await page.type('#composeSubjectInput', 'Release B Real Browser E2E');
    await page.$eval('[data-testid="compose-body-input"]', (el) => el.focus());
    await page.keyboard.type('Hello from real browser compose UI with v2 attachment.');

    const fileInput = await page.$('[data-testid="compose-file-input"]');
    assert(Boolean(fileInput), 'Found compose file input');
    await fileInput.uploadFile(samplePath);

    await page.waitForSelector('[title="Upload complete"]', { timeout: 20000 });
    assert(true, 'Browser uploaded & encrypted attachment (Upload complete badge visible)');

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'release_b_compose_ready.png') });

    await page.click('[data-testid="compose-send-btn"]');
    const sendEvent = await waitFor(
      async () => networkEvents.find((e) => e.url.includes('/v1/outbound/send')),
      '/v1/outbound/send network response',
      20000,
    );
    assert(sendEvent.status === 201 || sendEvent.status === 202, `/v1/outbound/send returned HTTP ${sendEvent.status}`);

    const storageDump = await page.evaluate(() => ({
      localStorage: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
      sessionStorage: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])),
    }));

    const cap = await waitFor(async () => (smtpMessages.length >= 1 ? smtpMessages[0] : null), 'SMTP delivery capture', 30000);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'release_b_compose_sent.png') });

    // Assert SMTP envelope & MIME integrity
    const rcptsJoined = cap.rcptTo.join(' ');
    assert(rcptsJoined.includes('external-browser@example.net'), 'SMTP RCPT TO includes To');
    assert(rcptsJoined.includes('cc-browser@example.net'), 'SMTP RCPT TO includes Cc');
    assert(rcptsJoined.includes('bcc-browser@example.net'), 'SMTP RCPT TO includes Bcc');
    assert(!/^bcc\s*:/im.test(cap.rawData.slice(0, cap.rawData.indexOf('\r\n\r\n'))), 'Zero Bcc header in SMTP DATA');

    const tree = parseMimeTree(cap.rawData);
    assert(tree.parts.length === 2, `Expected 2 MIME parts (body + 1 attachment), got ${tree.parts.length}`);
    const decodedAtt = Buffer.from(tree.parts[1].body.replace(/\s+/g, ''), 'base64');
    assert(sha256Buf(decodedAtt).equals(sha256Buf(sampleContent)), 'Decoded SMTP attachment matches browser file SHA-256');

    const attUploadEv = networkEvents.find((e) => e.method === 'POST' && e.url.includes('/attachments'));
    assert(Boolean(attUploadEv && attUploadEv.bodyPreview.includes('"crypto_version":2')), 'Browser upload used crypto_version=2');

    console.log('\n[DEVTOOLS NETWORK LOG]:');
    for (const ev of networkEvents) {
      console.log(`  ${ev.method} ${ev.url} -> ${ev.status} ${ev.bodyPreview}`);
    }
    console.log('\n[DEVTOOLS STORAGE KEYS]:');
    console.log('  localStorage keys:', JSON.stringify(Object.keys(storageDump.localStorage)));
    console.log('  sessionStorage keys:', JSON.stringify(Object.keys(storageDump.sessionStorage)));
    console.log('\n[DEVTOOLS CONSOLE ERRORS]:', consoleErrors.length);
    for (const ce of consoleErrors) console.log('  ERR:', ce);
    console.log('\nBROWSER E2E VERIFICATION PASSED!');
  } catch (err) {
    console.log('\n[DIAGNOSTIC NETWORK LOG ON ERROR]:');
    for (const ev of networkEvents) {
      console.log(`  ${ev.method} ${ev.url} -> ${ev.status} ${ev.bodyPreview}`);
    }
    try {
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'release_b_compose_error.png') });
    } catch {}
    throw err;
  } finally {
    if (browser) await browser.close();
    cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('BROWSER E2E FAILED:', err);
    process.exit(1);
  });
