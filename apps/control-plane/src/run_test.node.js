import { runDomainsTests } from "./lib/api/domains.test.js";
import { runMailboxesTests } from "./lib/api/mailboxes.test.js";
import { runEncodingTests } from "./lib/encoding.test.js";
import { runPricingMathTests } from "./lib/pricing_math.test.js";

async function main() {
  let totalFailed = 0;

  console.log("Running Encoding Utility Tests...");
  const encRes = runEncodingTests();
  console.log(`ENCODING TESTS: ${encRes.passed} passed, ${encRes.failed} failed\n`);
  totalFailed += encRes.failed;

  console.log("Running Pricing Math Tests...");
  const pricingRes = runPricingMathTests();
  console.log(`PRICING MATH TESTS: ${pricingRes.passed} passed, ${pricingRes.failed} failed\n`);
  totalFailed += pricingRes.failed;

  console.log("Running Domains API Tests...");
  const domainsRes = await runDomainsTests();
  console.log(`DOMAINS API TESTS: ${domainsRes.passed} passed, ${domainsRes.failed} failed\n`);
  totalFailed += domainsRes.failed;

  console.log("Running Mailboxes API Tests...");
  const mailboxesRes = await runMailboxesTests();
  console.log(`MAILBOXES API TESTS: ${mailboxesRes.passed} passed, ${mailboxesRes.failed} failed\n`);
  totalFailed += mailboxesRes.failed;

  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
