// Client-side, sovereign privacy-preserving translation utility
// Translates email text and subjects locally without leaking plaintext to 3rd-party APIs

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
];

export function getLanguageName(code: string): string {
  const clean = code.toLowerCase().split("-")[0];
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === clean);
  return found ? found.name : code.toUpperCase();
}

/**
 * Lightweight, client-side language detection based on scripts and stop words
 */
export function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) return "en";

  // 1. Script-based detection
  const clean = text.replace(/<[^>]*>/g, " ").toLowerCase();

  // Japanese (Hiragana / Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(clean)) return "ja";

  // Chinese (CJK characters without Japanese kana)
  if (/[\u4E00-\u9FFF]/.test(clean)) return "zh";

  // Arabic
  if (/[\u0600-\u06FF]/.test(clean)) return "ar";

  // Russian / Cyrillic
  if (/[\u0400-\u04FF]/.test(clean)) return "ru";

  // 2. Stop words tokenization for Latin-alphabet languages
  const tokens = clean
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (tokens.length === 0) return "en";

  const scores: Record<string, number> = {
    es: 0,
    fr: 0,
    de: 0,
    it: 0,
    pt: 0,
    nl: 0,
    en: 0,
  };

  const markers: Record<string, Set<string>> = {
    es: new Set([
      "el", "la", "de", "que", "en", "los", "del", "se", "las", "por", "un", "para", "con", "no", "una",
      "su", "al", "lo", "como", "mas", "más", "pero", "sus", "le", "ya", "o", "este", "sí", "porque",
      "esta", "cuando", "muy", "sin", "sobre", "ser", "tiene", "también", "tambien", "me", "hasta",
      "gracias", "saludos", "hola", "estimado", "estimada", "atentamente", "mensaje", "correo"
    ]),
    fr: new Set([
      "le", "la", "de", "des", "du", "et", "est", "une", "un", "pour", "dans", "qui", "que", "ce",
      "les", "en", "au", "aux", "sur", "avec", "par", "pas", "plus", "nous", "vous", "ils", "elles",
      "merci", "bonjour", "cordialement", "salutations", "courriel", "message", "bienvenue", "votre"
    ]),
    de: new Set([
      "der", "die", "das", "und", "in", "den", "von", "zu", "mit", "sich", "des", "auf", "für", "fuer",
      "ist", "im", "dem", "nicht", "ein", "eine", "einer", "als", "auch", "es", "an", "werden", "aus",
      "er", "hat", "dass", "sie", "nach", "wird", "bei", "oder", "wir", "ihr", "danke", "grüße", "gruesse",
      "hallo", "sehr", "geehrte", "geehrter", "nachricht", "termin"
    ]),
    it: new Set([
      "il", "la", "di", "che", "e", "è", "un", "a", "per", "in", "una", "mi", "sono", "ho", "ma",
      "ha", "se", "io", "ci", "come", "del", "della", "dei", "delle", "grazie", "ciao", "saluti", "cordiali"
    ]),
    pt: new Set([
      "o", "a", "de", "que", "do", "da", "em", "um", "para", "com", "não", "nao", "uma", "os", "no",
      "se", "na", "por", "mais", "as", "dos", "como", "mas", "foi", "ao", "ele", "das", "obrigado", "obrigada", "olá", "ola"
    ]),
    nl: new Set([
      "de", "het", "een", "van", "en", "in", "is", "op", "te", "dat", "die", "voor", "met", "niet",
      "om", "als", "er", "maar", "omdat", "bedankt", "hallo", "groeten", "vriendelijke"
    ]),
    en: new Set([
      "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with",
      "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her",
      "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up",
      "out", "if", "about", "who", "get", "which", "go", "me", "hello", "thanks", "regards", "sincerely"
    ]),
  };

  for (const token of tokens) {
    for (const [lang, set] of Object.entries(markers)) {
      if (set.has(token)) {
        scores[lang] = (scores[lang] || 0) + 1;
      }
    }
  }

  let maxLang = "en";
  let maxScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxLang = lang;
    }
  }

  return maxScore > 0 ? maxLang : "en";
}

// Common phrases and keywords translation dictionary
const PHRASE_DICTIONARY: Record<string, Record<string, string>> = {
  // English to other languages
  "hello": { es: "hola", fr: "bonjour", de: "hallo", it: "ciao", pt: "olá", nl: "hallo", zh: "你好", ja: "こんにちは", ru: "здравствуйте", ar: "مرحبا" },
  "good morning": { es: "buenos días", fr: "bonjour", de: "guten Morgen", it: "buongiorno", pt: "bom dia", nl: "goedemorgen", zh: "早上好", ja: "おはようございます", ru: "доброе утро", ar: "صباح الخير" },
  "good afternoon": { es: "buenas tardes", fr: "bon après-midi", de: "guten Tag", it: "buon pomeriggio", pt: "boa tarde", nl: "goedemiddag", zh: "下午好", ja: "こんにちは", ru: "добрый день", ar: "مساء الخير" },
  "good evening": { es: "buenas noches", fr: "bonsoir", de: "guten Abend", it: "buonasera", pt: "boa noite", nl: "goedenavond", zh: "晚上好", ja: "こんばんは", ru: "добрый вечер", ar: "مساء الخير" },
  "thank you": { es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", nl: "bedankt", zh: "谢谢", ja: "ありがとうございます", ru: "спасибо", ar: "شكرا لك" },
  "thanks": { es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", nl: "bedankt", zh: "多谢", ja: "ありがとう", ru: "спасибо", ar: "شكرا" },
  "best regards": { es: "saludos cordiales", fr: "cordialement", de: "mit freundlichen Grüßen", it: "cordiali saluti", pt: "atenciosamente", nl: "met vriendelijke groet", zh: "此致敬礼", ja: "よろしくお願いいたします", ru: "с наилучшими пожеланиями", ar: "مع أطيب التحيات" },
  "with kind regards": { es: "con atentos saludos", fr: "avec mes salutations distinguées", de: "mit besten Grüßen", it: "con cordiali saluti", pt: "com os melhores cumprimentos", nl: "met vriendelijke groet", zh: "致以最亲切的问候", ja: "敬具", ru: "с уважением", ar: "مع خالص التحيات" },
  "sincerely": { es: "atentamente", fr: "sincèrement", de: "hochachtungsvoll", it: "cordialmente", pt: "sinceramente", nl: "hoogachtend", zh: "真诚地", ja: "敬具", ru: "искренне ваш", ar: "المخلص" },
  "please let me know": { es: "por favor avísame", fr: "veuillez me faire savoir", de: "bitte lassen Sie mich wissen", it: "per favore fatemi sapere", pt: "por favor avise-me", nl: "laat het me weten", zh: "请告知我", ja: "お知らせください", ru: "пожалуйста, дайте мне знать", ar: "يرجى إعلامي" },
  "please find attached": { es: "adjunto encontrará", fr: "veuillez trouver ci-joint", de: "anbei finden Sie", it: "in allegato troverete", pt: "segue em anexo", nl: "in de bijlage vindt u", zh: "请查阅附件", ja: "添付ファイルをご確認ください", ru: "в приложении вы найдете", ar: "يرجى الاطلاع على المرفق" },
  "meeting": { es: "reunión", fr: "réunion", de: "Besprechung", it: "riunione", pt: "reunião", nl: "vergadering", zh: "会议", ja: "ミーティング", ru: "встреча", ar: "اجتماع" },
  "schedule": { es: "horario", fr: "calendrier", de: "Zeitplan", it: "programma", pt: "cronograma", nl: "schema", zh: "日程", ja: "スケジュール", ru: "расписание", ar: "جدول" },
  "confirmation": { es: "confirmación", fr: "confirmation", de: "Bestätigung", it: "conferma", pt: "confirmação", nl: "bevestiging", zh: "确认", ja: "確認", ru: "подтверждение", ar: "تأكيد" },
  "invoice": { es: "factura", fr: "facture", de: "Rechnung", it: "fattura", pt: "fatura", nl: "factuur", zh: "发票", ja: "請求書", ru: "счет", ar: "فاتورة" },
  "project update": { es: "actualización del proyecto", fr: "mise à jour du projet", de: "Projekt-Update", it: "aggiornamento del progetto", pt: "atualização do projeto", nl: "projectupdate", zh: "项目更新", ja: "プロジェクトの更新", ru: "обновление проекта", ar: "تحديث المشروع" },
  "important": { es: "importante", fr: "important", de: "wichtig", it: "importante", pt: "importante", nl: "belangrijk", zh: "重要", ja: "重要", ru: "важно", ar: "مهم" },
  "urgent": { es: "urgente", fr: "urgent", de: "dringend", it: "urgente", pt: "urgente", nl: "dringend", zh: "紧急", ja: "緊急", ru: "срочно", ar: "عاجل" },
  "attachment": { es: "archivo adjunto", fr: "pièce jointe", de: "Anhang", it: "allegato", pt: "anexo", nl: "bijlage", zh: "附件", ja: "添付ファイル", ru: "вложение", ar: "مرفق" },
  "security notification": { es: "notificación de seguridad", fr: "notification de sécurité", de: "Sicherheitsbenachrichtigung", it: "notifica di sicurezza", pt: "notificação de segurança", nl: "beveiligingsmelding", zh: "安全通知", ja: "セキュリティ通知", ru: "уведомление безопасности", ar: "إشعار أمني" },
  "welcome to": { es: "bienvenido a", fr: "bienvenue à", de: "willkommen bei", it: "benvenuto a", pt: "bem-vindo a", nl: "welkom bij", zh: "欢迎来到", ja: "へようこそ", ru: "добро пожаловать в", ar: "مرحبا بكم في" },
  "your account": { es: "tu cuenta", fr: "votre compte", de: "Ihr Konto", it: "il tuo account", pt: "sua conta", nl: "uw account", zh: "您的账户", ja: "あなたのアカウント", ru: "ваша учетная запись", ar: "حسابك" },
  "password reset": { es: "restablecimiento de contraseña", fr: "réinitialisation du mot de passe", de: "Passwort zurücksetzen", it: "reimpostazione della password", pt: "redefinição de senha", nl: "wachtwoord opnieuw instellen", zh: "重置密码", ja: "パスワードのリセット", ru: "сброс пароля", ar: "إعادة تعيين كلمة المرور" },
  "invitation": { es: "invitación", fr: "invitation", de: "Einladung", it: "invito", pt: "convite", nl: "uitnodiging", zh: "邀请", ja: "招待", ru: "приглашение", ar: "دعوة" },
  "weekly report": { es: "informe semanal", fr: "rapport hebdomadaire", de: "Wochenbericht", it: "rapporto settimanale", pt: "relatório semanal", nl: "wekelijks rapport", zh: "周报", ja: "週次レポート", ru: "еженедельный отчет", ar: "تقرير أسبوعي" },
};

const WORD_MAPPINGS: Record<string, Record<string, string>> = {
  // English to other languages
  "tomorrow": { es: "mañana", fr: "demain", de: "morgen", it: "domani", pt: "amanhã", zh: "明天", ja: "明日", ar: "غدا" },
  "today": { es: "hoy", fr: "aujourd'hui", de: "heute", it: "oggi", pt: "hoje", zh: "今天", ja: "今日", ar: "اليوم" },
  "yesterday": { es: "ayer", fr: "hier", de: "gestern", it: "ieri", pt: "ontem", zh: "昨天", ja: "昨日", ar: "أمس" },
  "week": { es: "semana", fr: "semaine", de: "Woche", it: "settimana", pt: "semana", zh: "周", ja: "週", ar: "أسبوع" },
  "new": { es: "nuevo", fr: "nouveau", de: "neu", it: "nuovo", pt: "novo", zh: "新", ja: "新しい", ar: "جديد" },
  "please": { es: "por favor", fr: "s'il vous plaît", de: "bitte", it: "per favore", pt: "por favor", zh: "请", ja: "お願いします", ar: "من فضلك" },

  // Spanish to English and others
  "hola": { en: "hello", fr: "bonjour", de: "hallo", it: "ciao", pt: "olá", zh: "你好", ja: "こんにちは", ar: "مرحبا" },
  "gracias": { en: "thank you", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", zh: "谢谢", ja: "ありがとう", ar: "شكرا" },
  "reunión": { en: "meeting", fr: "réunion", de: "Besprechung", it: "riunione", pt: "reunião", zh: "会议", ja: "ミーティング", ar: "اجتماع" },
  "reunion": { en: "meeting", fr: "réunion", de: "Besprechung", it: "riunione", pt: "reunião", zh: "会议", ja: "ミーティング", ar: "اجتماع" },
  "correo": { en: "email", fr: "courriel", de: "E-Mail", it: "email", pt: "email", zh: "邮件", ja: "メール", ar: "بريد" },
  "mensaje": { en: "message", fr: "message", de: "Nachricht", it: "messaggio", pt: "mensagem", zh: "信息", ja: "メッセージ", ar: "رسالة" },
  "cuenta": { en: "account", fr: "compte", de: "Konto", it: "conto", pt: "conta", zh: "账户", ja: "アカウント", ar: "حساب" },
  "urgente": { en: "urgent", fr: "urgent", de: "dringend", it: "urgente", pt: "urgente", zh: "紧急", ja: "緊急", ar: "عاجل" },
  "importante": { en: "important", fr: "important", de: "wichtig", it: "importante", pt: "importante", zh: "重要", ja: "重要", ar: "مهم" },
  "adjunto": { en: "attachment", fr: "pièce jointe", de: "Anhang", it: "allegato", pt: "anexo", zh: "附件", ja: "添付ファイル", ar: "مرفق" },
  "saludos": { en: "regards", fr: "cordialement", de: "Grüße", it: "saluti", pt: "cumprimentos", zh: "致意", ja: "敬具", ar: "تحياتي" },
  "confirmación": { en: "confirmation", fr: "confirmation", de: "Bestätigung", it: "conferma", pt: "confirmação", zh: "确认", ja: "確認", ar: "تأكيد" },
  "confirmacion": { en: "confirmation", fr: "confirmation", de: "Bestätigung", it: "conferma", pt: "confirmação", zh: "确认", ja: "確認", ar: "تأكيد" },
  "por favor": { en: "please", fr: "s'il vous plaît", de: "bitte", it: "per favore", pt: "por favor", zh: "请", ja: "お願いします", ar: "من فضلك" },
  "hoy": { en: "today", fr: "aujourd'hui", de: "heute", it: "oggi", pt: "hoje", zh: "今天", ja: "今日", ar: "اليوم" },
  "mañana": { en: "tomorrow", fr: "demain", de: "morgen", it: "domani", pt: "amanhã", zh: "明天", ja: "明日", ar: "غدا" },
  "ayer": { en: "yesterday", fr: "hier", de: "gestern", it: "ieri", pt: "ontem", zh: "昨天", ja: "昨日", ar: "أمس" },
  "semana": { en: "week", fr: "semaine", de: "Woche", it: "settimana", pt: "semana", zh: "周", ja: "週", ar: "أسبوع" },
  "nuevo": { en: "new", fr: "nouveau", de: "neu", it: "nuovo", pt: "novo", zh: "新", ja: "新しい", ar: "جديد" },
  "nueva": { en: "new", fr: "nouvelle", de: "neu", it: "nuova", pt: "nova", zh: "新", ja: "新しい", ar: "جديدة" },

  // French to English and others
  "bonjour": { en: "hello", es: "hola", de: "hallo", it: "ciao", pt: "olá", zh: "你好", ja: "こんにちは", ar: "مرحبا" },
  "merci": { en: "thank you", es: "gracias", de: "danke", it: "grazie", pt: "obrigado", zh: "谢谢", ja: "ありがとう", ar: "شكرا" },
  "réunion": { en: "meeting", es: "reunión", de: "Besprechung", it: "riunione", pt: "reunião", zh: "会议", ja: "ミーティング", ar: "اجتماع" },
  "courriel": { en: "email", es: "correo", de: "E-Mail", it: "email", pt: "email", zh: "邮件", ja: "メール", ar: "بريد" },
  "compte": { en: "account", es: "cuenta", de: "Konto", it: "conto", pt: "conta", zh: "账户", ja: "アカウント", ar: "حساب" },
  "demain": { en: "tomorrow", es: "mañana", de: "morgen", it: "domani", pt: "amanhã", zh: "明天", ja: "明日", ar: "غدا" },
  "aujourd'hui": { en: "today", es: "hoy", de: "heute", it: "oggi", pt: "hoje", zh: "今天", ja: "今日", ar: "اليوم" },
  "cordialement": { en: "best regards", es: "saludos cordiales", de: "mit freundlichen Grüßen", it: "cordiali saluti", pt: "atenciosamente", zh: "此致敬礼", ja: "敬具", ar: "مع أطيب التحيات" },

  // German to English and others
  "hallo": { en: "hello", es: "hola", fr: "bonjour", it: "ciao", pt: "olá", zh: "你好", ja: "こんにちは", ar: "مرحبا" },
  "danke": { en: "thank you", es: "gracias", fr: "merci", it: "grazie", pt: "obrigado", zh: "谢谢", ja: "ありがとう", ar: "شكرا" },
  "besprechung": { en: "meeting", es: "reunión", fr: "réunion", it: "riunione", pt: "reunião", zh: "会议", ja: "ミーティング", ar: "اجتماع" },
  "nachricht": { en: "message", es: "mensaje", fr: "message", it: "messaggio", pt: "mensagem", zh: "信息", ja: "メッセージ", ar: "رسالة" },
  "konto": { en: "account", es: "cuenta", fr: "compte", it: "conto", pt: "conta", zh: "账户", ja: "アカウント", ar: "حساب" },
  "heute": { en: "today", es: "hoy", fr: "aujourd'hui", it: "oggi", pt: "hoje", zh: "今天", ja: "今日", ar: "اليوم" },
  "morgen": { en: "tomorrow", es: "mañana", fr: "demain", it: "domani", pt: "amanhã", zh: "明天", ja: "明日", ar: "غدا" },
  "wichtig": { en: "important", es: "importante", fr: "important", it: "importante", pt: "importante", zh: "重要", ja: "重要", ar: "مهم" },
  "anhang": { en: "attachment", es: "adjunto", fr: "pièce jointe", it: "allegato", pt: "anexo", zh: "附件", ja: "添付ファイル", ar: "مرفق" },

  // Chinese to English
  "你好": { en: "hello", es: "hola", fr: "bonjour", de: "hallo", it: "ciao", pt: "olá", ja: "こんにちは", ru: "здравствуйте", ar: "مرحبا" },
  "谢谢": { en: "thank you", es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", ja: "ありがとうございます", ru: "спасибо", ar: "شكرا" },
  "会议": { en: "meeting", es: "reunión", fr: "réunion", de: "Besprechung", it: "riunione", pt: "reunião", ja: "ミーティング", ru: "встреча", ar: "اجتماع" },
  "邮件": { en: "email", es: "correo", fr: "courriel", de: "E-Mail", it: "email", pt: "email", ja: "メール", ru: "электронная почта", ar: "بريد" },
  "账户": { en: "account", es: "cuenta", fr: "compte", de: "Konto", it: "conto", pt: "conta", ja: "アカウント", ru: "аккаунт", ar: "حساب" },

  // Arabic to English
  "مرحبا": { en: "hello", es: "hola", fr: "bonjour", de: "hallo", it: "ciao", pt: "olá", zh: "你好", ja: "こんにちは", ru: "здравствуйте" },
  "شكرا": { en: "thank you", es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", zh: "谢谢", ja: "ありがとう", ru: "спасибо" },
  "اجتماع": { en: "meeting", es: "reunión", fr: "réunion", de: "Besprechung", it: "riunione", pt: "reunião", zh: "会议", ja: "ミーティング", ru: "встреча" },
};

/**
 * Creates a regex pattern matching terms cleanly across both Latin and non-Latin scripts.
 * CJK scripts do not use spaces between words, so word-boundary \b fails and is omitted.
 * Non-CJK scripts use Unicode character boundary assertions to avoid partial word collisions.
 */
function createSafeRegex(term: string): RegExp {
  const isCjk = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(term);
  const escaped = escapeRegExp(term);
  if (isCjk) {
    return new RegExp(escaped, "giu");
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Preserves original case style: ALL CAPS, Title Case, or lowercase.
 * For scripts without case distinctions (CJK, Arabic, Hebrew), returns replacement unaltered.
 */
function matchCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;

  // If the script has no case distinction (e.g. CJK, Arabic)
  if (original.toLowerCase() === original.toUpperCase()) {
    return replacement;
  }

  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Translates text preserving HTML markup and layout
 */
export function translateEmail(
  content: string,
  sourceLang: string,
  targetLang: string
): string {
  if (!content) return "";
  const sLang = sourceLang.toLowerCase().split("-")[0];
  const tLang = targetLang.toLowerCase().split("-")[0];

  if (sLang === tLang) {
    return content;
  }

  // Tokenize HTML tags so we only translate plain-text fragments
  const parts = content.split(/(<[^>]+>)/g);

  const translatedParts = parts.map((part) => {
    // If it's an HTML tag, don't modify it
    if (part.startsWith("<") && part.endsWith(">")) {
      return part;
    }

    // Translate text segment
    return translateTextSegment(part, sLang, tLang);
  });

  return translatedParts.join("");
}

function translateTextSegment(text: string, sourceLang: string, targetLang: string): string {
  if (!text || text.trim().length === 0) return text;

  let result = text;

  // 1. Check known multi-word phrases first
  // Sort phrases by descending candidate length to ensure longest matches are prioritized
  const phrasePairs: { candidate: string; replacement: string }[] = [];

  for (const [enTerm, transMap] of Object.entries(PHRASE_DICTIONARY)) {
    let candidateList: string[] = [];
    if (sourceLang === "en") {
      candidateList.push(enTerm);
    } else if (transMap[sourceLang]) {
      candidateList.push(transMap[sourceLang]);
    } else {
      candidateList.push(enTerm);
      for (const val of Object.values(transMap)) {
        candidateList.push(val);
      }
    }

    const replacement = targetLang === "en" ? enTerm : (transMap[targetLang] || enTerm);

    for (const cand of candidateList) {
      phrasePairs.push({ candidate: cand, replacement });
    }
  }

  phrasePairs.sort((a, b) => b.candidate.length - a.candidate.length);

  for (const { candidate, replacement } of phrasePairs) {
    const reg = createSafeRegex(candidate);
    result = result.replace(reg, (match) => matchCase(match, replacement));
  }

  // 2. Individual word substitutions for key terms
  const wordPairs: { candidate: string; replacement: string }[] = [];

  for (const [sourceWord, targetMap] of Object.entries(WORD_MAPPINGS)) {
    if (targetMap[targetLang]) {
      wordPairs.push({ candidate: sourceWord, replacement: targetMap[targetLang] });
    }
  }

  wordPairs.sort((a, b) => b.candidate.length - a.candidate.length);

  for (const { candidate, replacement } of wordPairs) {
    const reg = createSafeRegex(candidate);
    result = result.replace(reg, (match) => matchCase(match, replacement));
  }

  return result;
}
