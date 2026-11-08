import {
  translateEmail,
  detectLanguage,
  getLanguageName,
  SUPPORTED_LANGUAGES,
} from "./utils/translator";
import { t, setLocale, locale } from "./utils/i18n";

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
    assert(detectLanguage("नमस्ते, यह एक परीक्षण संदेश है") === "hi", "Hindi detection");
  });

  // 2. getLanguageName tests
  test("getLanguageName maps language codes correctly", () => {
    assert(getLanguageName("en") === "English", "en -> English");
    assert(getLanguageName("es") === "Spanish", "es -> Spanish");
    assert(getLanguageName("zh") === "Chinese", "zh -> Chinese");
    assert(getLanguageName("ar") === "Arabic", "ar -> Arabic");
    assert(getLanguageName("hi") === "Hindi", "hi -> Hindi");
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

  // 10. Multi-target translation tests (French, German, Hindi)
  test("translateEmail translates into French, German, and Hindi", () => {
    const enText = "Hello team, thank you for your update about the meeting tomorrow.";
    const frText = translateEmail(enText, "en", "fr");
    assert(frText.includes("Bonjour"), "Contains French Bonjour");
    assert(frText.includes("merci"), "Contains French merci");

    const deText = translateEmail(enText, "en", "de");
    assert(deText.includes("Hallo"), "Contains German Hallo");
    assert(deText.includes("danke"), "Contains German danke");

    const hiText = translateEmail(enText, "en", "hi");
    assert(hiText.includes("नमस्ते"), "Contains Hindi Namaste");
    assert(hiText.includes("धन्यवाद"), "Contains Hindi Dhanyavaad");
  });

  // 11. Full email paragraph translation without leaving untranslated English words
  test("translateEmail translates full email paragraphs without leaving untranslated English words", () => {
    const emailBody = "<p>Hello team, I have attached the meeting notes and presentation for the team to review before tomorrow's call. Let me know if you have any questions or feedback. Best regards, Alice</p>";
    const es = translateEmail(emailBody, "en", "es");
    assert(es.startsWith("<p>") && es.endsWith("</p>"), "Preserves enclosing <p> tags");
    assert(es.includes("notas de la reunión"), "Translates meeting notes -> notas de la reunión");
    assert(es.includes("presentación"), "Translates presentation -> presentación");
    assert(es.includes("revisar"), "Translates review -> revisar");
    assert(es.includes("preguntas") || es.includes("pregunta"), "Translates questions -> preguntas");
    assert(es.includes("comentarios") || es.includes("comentario"), "Translates feedback -> comentarios");
    assert(!es.includes("meeting notes"), "Does not leave 'meeting notes' untranslated in English");
    assert(!es.includes("presentation"), "Does not leave 'presentation' untranslated in English");

    const ja = translateEmail(emailBody, "en", "ja");
    assert(ja.includes("会議メモ"), "Japanese translates meeting notes to 会議メモ");
    assert(!ja.includes("meeting notes"), "Japanese does not leave 'meeting notes' in English");
  });

  // 12. Chinese and Russian email paragraph translation with business vocabulary
  test("translateEmail translates corporate email into Chinese and Russian with zero residual English", () => {
    const businessEmail = "<p>Dear team, please review our company policy and server migration schedule before tomorrow. Urgent action required!</p>";

    const zh = translateEmail(businessEmail, "en", "zh");
    assert(zh.startsWith("<p>") && zh.endsWith("</p>"), "Preserves enclosing HTML tags");
    assert(zh.includes("公司"), "Chinese translates 'company' to 公司");
    assert(zh.includes("政策"), "Chinese translates 'policy' to 政策");
    assert(zh.includes("服务器迁移计划") || (zh.includes("服务器") && zh.includes("迁移")), "Chinese translates server migration");
    assert(!zh.includes("company"), "Chinese does not leave 'company' in English");
    assert(!zh.includes("policy"), "Chinese does not leave 'policy' in English");
    assert(!zh.includes("server"), "Chinese does not leave 'server' in English");
    assert(!zh.includes("schedule"), "Chinese does not leave 'schedule' in English");

    const ru = translateEmail(businessEmail, "en", "ru");
    assert(ru.includes("компания") || ru.includes("компании"), "Russian translates 'company'");
    assert(ru.includes("политика") || ru.includes("политики"), "Russian translates 'policy'");
    assert(!ru.includes("company"), "Russian does not leave 'company' in English");
    assert(!ru.includes("policy"), "Russian does not leave 'policy' in English");
  });

  // 13. UI Localization (t helper) across locales
  test("t helper returns correct localized UI strings across all supported locales", () => {
    setLocale("es");
    assert(t("Settings") === "Configuración", "es: Settings -> Configuración");
    assert(t("Search emails") === "Buscar correos", "es: Search emails -> Buscar correos");
    assert(t("Emails") === "Correos", "es: Emails -> Correos");
    assert(t("Calendar") === "Calendario", "es: Calendar -> Calendario");
    assert(t("Notes") === "Notas", "es: Notes -> Notas");
    assert(t("Translate") === "Traducir", "es: Translate -> Traducir");
    assert(t("UI Customizer") === "Personalizador de interfaz", "es: UI Customizer -> Personalizador de interfaz");
    assert(t("Private Mailbox") === "Buzón privado", "es: Private Mailbox -> Buzón privado");

    setLocale("fr");
    assert(t("Settings") === "Paramètres", "fr: Settings -> Paramètres");
    assert(t("Search emails") === "Rechercher dans les e-mails", "fr: Search emails -> Rechercher dans les e-mails");
    assert(t("Translate") === "Traduire", "fr: Translate -> Traduire");

    setLocale("de");
    assert(t("Settings") === "Einstellungen", "de: Settings -> Einstellungen");
    assert(t("Translate") === "Übersetzen", "de: Translate -> Übersetzen");

    setLocale("zh");
    assert(t("Settings") === "设置", "zh: Settings -> 设置");
    assert(t("Emails") === "邮件", "zh: Emails -> 邮件");
    assert(t("Translate") === "翻译", "zh: Translate -> 翻译");

    setLocale("ja");
    assert(t("Settings") === "設定", "ja: Settings -> 設定");
    assert(t("Translate") === "翻訳", "ja: Translate -> 翻訳");

    setLocale("ar");
    assert(t("Settings") === "الإعدادات", "ar: Settings -> الإعدادات");
    assert(t("Translate") === "ترجمة", "ar: Translate -> ترجمة");

    setLocale("hi");
    assert(t("Settings") === "सेटिंग्स", "hi: Settings -> सेटिंग्स");
    assert(t("Translate") === "अनुवाद करें", "hi: Translate -> अनुवाद करें");

    // Reset back to en
    setLocale("en");
    assert(t("Settings") === "Settings", "en: Settings -> Settings");
  });

  // 14. UI String parameter interpolation
  test("t helper interpolates dynamic params accurately without affecting proper nouns", () => {
    setLocale("es");
    assert(
      t("Display language set to {lang}", { lang: "ES" }) === "Idioma de interfaz establecido en ES",
      "Dynamic lang code interpolation in Spanish"
    );
    assert(
      t("Display name saved: {name}", { name: "Alice Smith" }) === "Nombre para mostrar guardado: Alice Smith",
      "Preserves person's name Alice Smith verbatim"
    );
    assert(
      t("Always translate {lang}", { lang: "English" }) === "Traducir siempre English",
      "Always translate language interpolation"
    );
    assert(
      t("{count} selected", { count: 5 }) === "5 seleccionados",
      "Count param interpolation"
    );
    setLocale("en");
  });

  // 15. Fallback behavior for missing keys or locales
  test("t helper gracefully falls back to English and key itself for unknown keys", () => {
    setLocale("es");
    assert(t("NON_EXISTENT_TRANSLATION_KEY_12345") === "NON_EXISTENT_TRANSLATION_KEY_12345", "Unknown key returns raw key");
    assert(t("") === "", "Empty key returns empty string");
    setLocale("en");
  });

  return { passed, failed };
}


