// Unit tests for client_crypto.ts
import {
  deriveClientPasswordVerifier,
  extract12WordMnemonic,
  evaluatePasswordStrength,
} from "./client_crypto.js";

export async function runClientCryptoTests() {
  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, msg: string) {
    if (cond) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL: ${msg}`);
    }
  }

  console.log("=== Testing Client Cryptography & Zero-Knowledge Pre-Hashing ===");

  // 1. Deterministic Password Verifier
  try {
    const verifier1 = await deriveClientPasswordVerifier("BYOSTest2026!", "admin@demo.local");
    const verifier2 = await deriveClientPasswordVerifier("BYOSTest2026!", "admin@demo.local");
    const verifierOther = await deriveClientPasswordVerifier("DifferentPassword!", "admin@demo.local");
    const verifierOtherEmail = await deriveClientPasswordVerifier("BYOSTest2026!", "other@demo.local");

    assert(typeof verifier1 === "string", "Verifier is a string");
    assert(verifier1.length === 64, "Verifier is 64-character hex (32 bytes)");
    assert(verifier1 === verifier2, "Verifier derivation is deterministic for same password & email");
    assert(verifier1 !== verifierOther, "Different passwords yield distinct verifiers");
    assert(verifier1 !== verifierOtherEmail, "Domain separation prevents cross-email credential reuse");
  } catch (err) {
    assert(false, `deriveClientPasswordVerifier threw: ${err}`);
  }

  // 2. 12-Word Mnemonic Extraction
  try {
    const mockMnemonic24 = "apple banana cherry date elderberry fig grape honeydew kiwi lemon mango nectarine orange papaya quince raspberry strawberry tangerine uva valerian watermelon xigua yam zucchini";
    const extracted = extract12WordMnemonic(mockMnemonic24);

    assert(extracted.words.length === 12, "Extracts exactly 12 words");
    assert(extracted.phrase.split(" ").length === 12, "Extracted phrase has 12 space-separated words");
    assert(extracted.words[0] === "apple", "First word matches expected");
    assert(extracted.words[11] === "nectarine", "12th word matches expected");
  } catch (err) {
    assert(false, `extract12WordMnemonic threw: ${err}`);
  }

  // 3. Password Strength Evaluation
  try {
    const weak = evaluatePasswordStrength("short");
    assert(!weak.isCompliant, "Short password is non-compliant");
    assert(weak.score === 1, "Short password scores 1 (Weak)");

    const strong = evaluatePasswordStrength("BYOSTest2026!#Sovereign");
    assert(strong.isCompliant, "Complex password is compliant");
    assert(strong.score === 4, "Complex password scores 4 (Strong)");
    assert(strong.hasLength && strong.hasUpper && strong.hasLower && strong.hasNumber && strong.hasSpecial, "All criteria satisfied");
  } catch (err) {
    assert(false, `evaluatePasswordStrength threw: ${err}`);
  }

  return { passed, failed };
}
