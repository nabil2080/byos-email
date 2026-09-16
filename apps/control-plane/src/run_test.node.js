import { runDomainsTests } from "./lib/api/domains.test.js";

async function main() {
  console.log("Running Domains API Tests...");
  const res = await runDomainsTests();
  console.log(`DOMAINS API TESTS: ${res.passed} passed, ${res.failed} failed\n`);
  if (res.failed > 0) process.exit(1);
}

main().catch(console.error);
