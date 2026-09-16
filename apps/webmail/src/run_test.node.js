import { runAttachmentCryptoTests } from "./attachment_crypto.test.js";
import { runTotpTests } from "./utils/totp.test.js";
import { runDateTimeTests } from "./utils/dateTime.test.js";
import { runFileTypeTests } from "./fileType.test.js";
import { runMultiAccountTests } from "./multi_account.test.js";

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

  console.log("Running Date Time Tests...");
  const dateTimeRes = runDateTimeTests();
  console.log(`DATE TIME TESTS: ${dateTimeRes.passed} passed, ${dateTimeRes.failed} failed\n`);
  totalPassed += dateTimeRes.passed;
  totalFailed += dateTimeRes.failed;

  console.log("Running File Type Tests...");
  const fileTypeRes = runFileTypeTests();
  console.log(`FILE TYPE TESTS: ${fileTypeRes.passed} passed, ${fileTypeRes.failed} failed\n`);
  totalPassed += fileTypeRes.passed;
  totalFailed += fileTypeRes.failed;

  const multiAccountRes = runMultiAccountTests();
  console.log(`MULTI ACCOUNT TESTS: ${multiAccountRes.passed} passed, ${multiAccountRes.failed} failed\n`);
  totalPassed += multiAccountRes.passed;
  totalFailed += multiAccountRes.failed;

  console.log(`OVERALL: ${totalPassed} passed, ${totalFailed} failed`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
