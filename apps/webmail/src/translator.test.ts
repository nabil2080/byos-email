import {
  translateEmail,
  detectLanguage,
  getLanguageName,
  SUPPORTED_LANGUAGES,
} from "./utils/translator";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runTranslatorTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Translator & Localization Tests...");

  // 1. Language detection tests
  test("detectLanguage identifies supported scripts and stop words", () => {
    assert(detectLanguage("") === "en", "Empty input defaults to 'en'");
    assert(detectLanguage("   ") === "en", "Whitespace defaults to 'en'");
    assert(detectLanguage("Hello team, please see the meeting notes.") === "en", "English detection");
    assert(detectLanguage("Hola a todos, gracias por su correo y reunión.") === "es", "Spanish detection");
    assert(detectLanguage("Bonjour tout le monde, merci pour votre message.") === "fr", "French detection");
    assert(detectLanguage("Guten Tag, danke für die Einladung und den Termin.") === "de", "German detection");
    assert(detectLanguage("Ciao a tutti, grazie per la riunione.") === "it", "Italian detection");
    assert(detectLanguage("Olá a todos, obrigado pela mensagem.") === "pt", "Portuguese detection");
    assert(detectLanguage("Hallo allemaal, bedankt voor het bericht.") === "nl", "Dutch detection");
    assert(detectLanguage("你好，这是一个测试邮件") === "zh", "Chinese detection");
    assert(detectLanguage("こんにちは、ミーティングの件です") === "ja", "Japanese detection");
    assert(detectLanguage("مرحبا بكم في هذا الاجتماع") === "ar", "Arabic detection");
    assert(detectLanguage("Здравствуйте, спасибо за сообщение") === "ru", "Russian detection");
  });

  // 2. getLanguageName tests
  test("getLanguageName maps language codes correctly", () => {
    assert(getLanguageName("en") === "English", "en -> English");
    assert(getLanguageName("es") === "Spanish", "es -> Spanish");
    assert(getLanguageName("zh") === "Chinese", "zh -> Chinese");
    assert(getLanguageName("ar") === "Arabic", "ar -> Arabic");
    assert(getLanguageName("unknown") === "UNKNOWN", "Fallback to uppercase code");
  });

  // 3. Translation identity test
  test("translateEmail returns identical content when source and target match", () => {
    const original = "<p>Hello world, this is a test.</p>";
    assert(translateEmail(original, "en", "en") === original, "Identical lang should return original unchanged");
    assert(translateEmail(original, "es", "es") === original, "Identical es should return original unchanged");
  });

  // 4. HTML tag preservation test
  test("translateEmail preserves HTML tags, attributes, and structure", () => {
    const html = `<div class="email-body"><p>Hello!</p><a href="https://example.com/meeting" title="urgent meeting">Click here</a></div>`;
    const translated = translateEmail(html, "en", "es");

    assert(translated.includes(`<div class="email-body">`), "Preserves outer div tag and class");
    assert(translated.includes(`<a href="https://example.com/meeting" title="urgent meeting">`), "Preserves href and title attributes without altering URLs");
    assert(translated.includes(`Hola!`), "Translates inner text Hello -> Hola");
  });

  // 5. Casing preservation test (Upper, Title, Lower)
  test("translateEmail preserves casing in Latin scripts", () => {
    assert(translateEmail("HELLO", "en", "es") === "HOLA", "All-caps HELLO -> HOLA");
    assert(translateEmail("Hello", "en", "es") === "Hola", "Title-case Hello -> Hola");
    assert(translateEmail("hello", "en", "es") === "hola", "Lowercase hello -> hola");
  });

  // 6. Non-cased script translation (CJK & Arabic) without uppercase distortion
  test("translateEmail translates CJK and Arabic to English without screaming all-caps", () => {
    const zhTranslated = translateEmail("你好", "zh", "en");
    assert(zhTranslated === "hello", `Chinese '你好' translated to lowercase 'hello', got '${zhTranslated}'`);

    const arTranslated = translateEmail("مرحبا", "ar", "en");
    assert(arTranslated === "hello", `Arabic 'مرحبا' translated to lowercase 'hello', got '${arTranslated}'`);
  });

  // 7. Word boundary safety test (does not replace sub-words)
  test("translateEmail does not replace subwords like 'Othello' or 'shell'", () => {
    const text = "Othello went to the shell";
    const translated = translateEmail(text, "en", "es");
    assert(translated.includes("Othello"), "Does not match 'hello' inside 'Othello'");
    assert(translated.includes("shell"), "Does not match 'hell' inside 'shell'");
  });

  // 8. Multi-word phrase translation prioritization
  test("translateEmail prioritizes longer multi-word phrases over single words", () => {
    const text = "Best regards,\nJane Doe";
    const translated = translateEmail(text, "en", "es");
    assert(translated.includes("Saludos cordiales"), `Should translate 'Best regards' as phrase, got '${translated}'`);
  });

  // 9. Round-trip dictionary translation
  test("translateEmail roundtrip between English and Spanish", () => {
    const enText = "Hello, please let me know about the meeting tomorrow.";
    const esText = translateEmail(enText, "en", "es");
    assert(esText.includes("Hola"), "Contains Hola");
    assert(esText.includes("reunión"), "Contains reunión");
    assert(esText.includes("mañana"), "Contains mañana");

    const backToEn = translateEmail(esText, "es", "en");
    assert(backToEn.includes("Hello"), "Roundtrip restores Hello");
    assert(backToEn.includes("meeting"), "Roundtrip restores meeting");
    assert(backToEn.includes("tomorrow"), "Roundtrip restores tomorrow");
  });

  return { passed, failed };
}
