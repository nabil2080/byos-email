import { runDomainsTests } from "./lib/api/domains.test.js";
import { runMailboxesTests } from "./lib/api/mailboxes.test.js";
import { runOnboardingTests } from "./lib/api/onboarding.test.ts";
import { runEncodingTests } from "./lib/encoding.test.js";
import { runClientCryptoTests } from "./lib/crypto/client_crypto.test.ts";
import { runPricingMathTests } from "./lib/pricing_math.test.ts";
import { runTourRunnerTests } from "./tours/runner.test.ts";
import { runSearchTests } from "./lib/api/search.test.ts";
import { runTotpTests } from "./utils/totp.test.ts";
import { runAuth2FATests } from "./lib/api/auth_2fa.test.ts";

async function main() {
  let totalFailed = 0;

  console.log("Running Encoding Utility Tests...");
  const encRes = runEncodingTests();
  console.log(`ENCODING TESTS: ${encRes.passed} passed, ${encRes.failed} failed\n`);
  totalFailed += encRes.failed;

  console.log("Running Client Cryptography & Zero-Knowledge Tests...");
  const cryptoRes = await runClientCryptoTests();
  console.log(`CRYPTO TESTS: ${cryptoRes.passed} passed, ${cryptoRes.failed} failed\n`);
  totalFailed += cryptoRes.failed;

  console.log("Running B2B Graduated Pricing Math Tests...");
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

  console.log("Running Onboarding Wizard API Tests...");
  const onboardingRes = await runOnboardingTests();
  console.log(`ONBOARDING API TESTS: ${onboardingRes.passed} passed, ${onboardingRes.failed} failed\n`);
  totalFailed += onboardingRes.failed;

  console.log("Running Product Tour Step Definitions & Client Tests...");
  const tourRes = await runTourRunnerTests();
  console.log(`PRODUCT TOUR TESTS: ${tourRes.passed} passed, ${tourRes.failed} failed\n`);
  totalFailed += tourRes.failed;

  console.log("Running Global Search & Navigation Tests...");
  const searchRes = await runSearchTests();
  console.log(`SEARCH TESTS: ${searchRes.passed} passed, ${searchRes.failed} failed\n`);
  totalFailed += searchRes.failed;

  console.log("Running Client TOTP Utility Tests...");
  const totpRes = await runTotpTests();
  console.log(`TOTP TESTS: ${totpRes.passed} passed, ${totpRes.failed} failed\n`);
  totalFailed += totpRes.failed;

  console.log("Running 2FA API Client Tests...");
  const auth2faRes = await runAuth2FATests();
  console.log(`2FA API TESTS: ${auth2faRes.passed} passed, ${auth2faRes.failed} failed\n`);
  totalFailed += auth2faRes.failed;

  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
