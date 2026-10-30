import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function testDomain(origin) {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto(`${origin}/login`, { waitUntil: "networkidle2" });

  const result = await page.evaluate(async () => {
    try {
      await navigator.credentials.create({
        publicKey: {
          challenge: new Uint8Array([1, 2, 3, 4]),
          rp: { name: "BYOS Secure Email", id: "localhost" },
          user: { id: new Uint8Array([1, 2, 3, 4]), name: "test@byos.local", displayName: "Test User" },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
          timeout: 1000
        }
      });
      return { success: true };
    } catch (err) {
      return {
        name: err.name,
        message: err.message,
        code: err.code
      };
    }
  });

  await browser.close();
  return result;
}

async function main() {
  console.log("Testing origin http://127.0.0.1:3000 with rp.id 'localhost':");
  const res127 = await testDomain("http://127.0.0.1:3000");
  console.log("Result (127.0.0.1):", JSON.stringify(res127));

  console.log("\nTesting origin http://localhost:3000 with rp.id 'localhost':");
  const resLocalhost = await testDomain("http://localhost:3000");
  console.log("Result (localhost):", JSON.stringify(resLocalhost));
}

main().catch(console.error);
