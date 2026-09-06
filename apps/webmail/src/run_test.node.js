import { runAttachmentCryptoTests } from "./attachment_crypto.test.js";

const { passed, failed } = runAttachmentCryptoTests();
console.log(`ATTACHMENT CRYPTO TESTS: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
