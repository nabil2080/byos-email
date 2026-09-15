import { runAttachmentCryptoTests } from "./attachment_crypto.test.js";
import { runTotpTests } from "./utils/totp.test.js";

async function main() {
  let totalPassed = 0;
  let totalFailed = 0;

  console.log("Running Attachment Crypto Tests...");
  const attachmentRes = runAttachmentCryptoTests();
  console.log(`ATTACHMENT CRYPTO TESTS: ${attachmentRes.passed} passed, ${attachmentRes.failed} failed\n`);
  totalPassed += attachmentRes.passed;
  totalFailed += attachmentRes.failed;

  console.log("Running TOTP Tests...");
  const totpRes = await runTotpTests();
  console.log(`TOTP TESTS: ${totpRes.passed} passed, ${totpRes.failed} failed\n`);
  totalPassed += totpRes.passed;
  totalFailed += totpRes.failed;

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
