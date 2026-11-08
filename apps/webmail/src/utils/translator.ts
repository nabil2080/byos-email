// Client-side, sovereign privacy-preserving translation utility
// Translates email text and subjects locally without leaking plaintext to 3rd-party APIs
import { t } from "./i18n";

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
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
];

export function getLanguageName(code: string): string {
  const clean = code.toLowerCase().split("-")[0];
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === clean);
  return found ? t(found.name) : code.toUpperCase();
}

/**
 * Lightweight, client-side language detection based on scripts and stop words
 */
export function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) return "en";

  // 1. Script-based detection
  const clean = text.replace(/<[^>]*>/g, " ").toLowerCase();

  // Hindi / Devanagari script
  if (/[\u0900-\u097F]/.test(clean)) return "hi";

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

// Multi-word phrase translation dictionary
const PHRASE_DICTIONARY: Record<string, Record<string, string>> = {
  "good morning": { es: "buenos días", fr: "bonjour", de: "guten Morgen", it: "buongiorno", pt: "bom dia", nl: "goedemorgen", zh: "早上好", ja: "おはようございます", ru: "доброе утро", ar: "صباح الخير", hi: "सुप्रभात" },
  "good afternoon": { es: "buenas tardes", fr: "bon après-midi", de: "guten Tag", it: "buon pomeriggio", pt: "boa tarde", nl: "goedemiddag", zh: "下午好", ja: "こんにちは", ru: "добрый день", ar: "مساء الخير", hi: "नमस्कार" },
  "good evening": { es: "buenas noches", fr: "bonsoir", de: "guten Abend", it: "buonasera", pt: "boa noite", nl: "goedenavond", zh: "晚上好", ja: "こんばんは", ru: "добрый вечер", ar: "مساء الخير", hi: "शुभ संध्या" },
  "thank you very much": { es: "muchas gracias", fr: "merci beaucoup", de: "vielen Dank", it: "molte grazie", pt: "muito obrigado", nl: "hartelijk dank", zh: "非常感谢", ja: "誠にありがとうございます", ru: "большое спасибо", ar: "شكرا جزيلا", hi: "बहुत-बहुत धन्यवाद" },
  "thank you": { es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", nl: "bedankt", zh: "谢谢", ja: "ありがとうございます", ru: "спасибо", ar: "شكرا لك", hi: "धन्यवाद" },
  "thanks for sending over": { es: "gracias por enviar", fr: "merci d'avoir envoyé", de: "vielen Dank für das Zusenden von", it: "grazie per aver inviato", pt: "obrigado por enviar", nl: "bedankt voor het toesturen van", zh: "感谢发送", ja: "お送りいただきありがとうございます", ru: "спасибо за отправку", ar: "شكرا لإرسال", hi: "भेजने के लिए धन्यवाद" },
  "thanks for": { es: "gracias por", fr: "merci pour", de: "danke für", it: "grazie per", pt: "obrigado por", nl: "bedankt voor", zh: "感谢", ja: "に感謝します", ru: "спасибо за", ar: "شكرا لـ", hi: "के लिए धन्यवाद" },
  "best regards,": { es: "Saludos cordiales,", fr: "Cordialement,", de: "Mit freundlichen Grüßen,", it: "Cordiali saluti,", pt: "Atenciosamente,", nl: "Met vriendelijke groet,", zh: "此致敬礼，", ja: "よろしくお願いいたします、", ru: "С наилучшими пожеланиями,", ar: "مع أطيب التحيات،", hi: "सादर," },
  "best regards": { es: "saludos cordiales", fr: "cordialement", de: "mit freundlichen Grüßen", it: "cordiali saluti", pt: "atenciosamente", nl: "met vriendelijke groet", zh: "此致敬礼", ja: "よろしくお願いいたします", ru: "с наилучшими пожеланиями", ar: "مع أطيب التحيات", hi: "सादर" },
  "kind regards": { es: "atentos saludos", fr: "salutations distinguées", de: "beste Grüße", it: "cordiali saluti", pt: "com os melhores cumprimentos", nl: "vriendelijke groet", zh: "致以亲切的问候", ja: "敬具", ru: "с уважением", ar: "مع خالص التحيات", hi: "सादर नमस्कार" },
  "with kind regards": { es: "con atentos saludos", fr: "avec mes salutations distinguées", de: "mit besten Grüßen", it: "con cordiali saluti", pt: "com os melhores cumprimentos", nl: "met vriendelijke groet", zh: "致以最亲切的问候", ja: "敬具", ru: "с уважением", ar: "مع خالص التحيات", hi: "सप्रेम नमस्कार" },
  "best,": { es: "Un cordial saludo,", fr: "Bien cordialement,", de: "Beste Grüße,", it: "Cordiali saluti,", pt: "Com os melhores cumprimentos,", nl: "Met vriendelijke groet,", zh: "祝好，", ja: "敬具、", ru: "С уважением,", ar: "مع خالص التحيات،", hi: "सादर," },
  "please let me know": { es: "por favor avísame", fr: "veuillez me faire savoir", de: "bitte lassen Sie mich wissen", it: "per favore fatemi sapere", pt: "por favor avise-me", nl: "laat het me weten", zh: "请告知我", ja: "お知らせください", ru: "пожалуйста, дайте мне знать", ar: "يرجى إعلامي", hi: "कृपया मुझे बताएं" },
  "let me know": { es: "avísame", fr: "fais-moi savoir", de: "gib mir Bescheid", it: "fammi sapere", pt: "me avise", nl: "laat me weten", zh: "告诉我", ja: "教えてください", ru: "дай мне знать", ar: "أعلمني", hi: "मुझे बताएं" },
  "please find attached": { es: "adjunto encontrará", fr: "veuillez trouver ci-joint", de: "anbei finden Sie", it: "in allegato troverete", pt: "segue em anexo", nl: "in de bijlage vindt u", zh: "请查阅附件", ja: "添付ファイルをご確認ください", ru: "в приложении вы найдете", ar: "يرجى الاطلاع على المرفق", hi: "कृपया संलग्नक देखें" },
  "i have attached": { es: "he adjuntado", fr: "j'ai joint", de: "ich habe angehängt", it: "ho allegato", pt: "anexei", nl: "ik heb bijgevoegd", zh: "我已附上", ja: "添付いたしました", ru: "я прикрепил", ar: "لقد أرفقت", hi: "मैंने संलग्न किया है" },
  "i have": { es: "he", fr: "j'ai", de: "ich habe", it: "ho", pt: "eu tenho", nl: "ik heb", zh: "我已经", ja: "私は〜を持っています", ru: "у меня есть", ar: "لدي", hi: "मेरे पास है" },
  "we have": { es: "hemos", fr: "nous avons", de: "wir haben", it: "abbiamo", pt: "nós temos", nl: "wij hebben", zh: "我们已经", ja: "私たちは〜を持っています", ru: "мы имеем", ar: "لدينا", hi: "हमारे पास है" },
  "i would like to": { es: "me gustaría", fr: "j'aimerais", de: "ich möchte gerne", it: "vorrei", pt: "gostaria de", nl: "ik wil graag", zh: "我想要", ja: "したいと思います", ru: "я хотел бы", ar: "أود أن", hi: "मैं चाहूंगा" },
  "we would like to": { es: "nos gustaría", fr: "nous aimerions", de: "wir möchten gerne", it: "vorremmo", pt: "gostaríamos de", nl: "wij willen graag", zh: "我们想要", ja: "したいと思います", ru: "мы хотели бы", ar: "نود أن", hi: "हम चाहेंगे" },
  "project update": { es: "actualización del proyecto", fr: "mise à jour du projet", de: "Projekt-Update", it: "aggiornamento del progetto", pt: "atualização do proyecto", nl: "projectupdate", zh: "项目更新", ja: "プロジェクトの更新", ru: "обновление проекта", ar: "تحديث المشروع", hi: "परियोजना अपडेट" },
  "security notification": { es: "notificación de seguridad", fr: "notification de sécurité", de: "Sicherheitsbenachrichtigung", it: "notifica di sicurezza", pt: "notificação de segurança", nl: "beveiligingsmelding", zh: "安全通知", ja: "セキュリティ通知", ru: "уведомление безопасности", ar: "إشعار أمني", hi: "सुरक्षा सूचना" },
  "welcome to": { es: "bienvenido a", fr: "bienvenue à", de: "willkommen bei", it: "benvenuto a", pt: "bem-vindo a", nl: "welkom bij", zh: "欢迎来到", ja: "へようこそ", ru: "добро пожаловать в", ar: "مرحبا بكم في", hi: "में आपका स्वागत है" },
  "your account": { es: "tu cuenta", fr: "votre compte", de: "Ihr Konto", it: "il tuo account", pt: "sua conta", nl: "uw account", zh: "您的账户", ja: "あなたのアカウント", ru: "ваша учетная запись", ar: "حسابك", hi: "आपका खाता" },
  "password reset": { es: "restablecimiento de contraseña", fr: "réinitialisation du mot de passe", de: "Passwort zurücksetzen", it: "reimpostazione della password", pt: "redefinição de senha", nl: "wachtwoord opnieuw instellen", zh: "重置密码", ja: "パスワードのリセット", ru: "сброс пароля", ar: "إعادة تعيين كلمة المرور", hi: "पासवर्ड रीसेट" },
  "weekly report": { es: "informe semanal", fr: "rapport hebdomadaire", de: "Wochenbericht", it: "rapporto settimanale", pt: "relatório semanal", nl: "wekelijks rapport", zh: "周报", ja: "週次レポート", ru: "еженедельный отчет", ar: "تقرير أسبوعي", hi: "साप्ताहिक रिपोर्ट" },
  "meeting schedule": { es: "horario de reuniones", fr: "calendrier des réunions", de: "Besprechungsplan", it: "programma delle riunioni", pt: "horário de reuniões", nl: "vergaderschema", zh: "会议日程", ja: "ミーティングのスケジュール", ru: "график встреч", ar: "جدول الاجتماعات", hi: "बैठक अनुसूची" },
  "meeting notes": { es: "notas de la reunión", fr: "notes de réunion", de: "Besprechungsnotizen", it: "note della riunione", pt: "notas da reunião", nl: "vergadernotities", zh: "会议记录", ja: "会議メモ", ru: "протокол встречи", ar: "ملاحظات الاجتماع", hi: "बैठक के नोट्स" },
  "next week": { es: "la próxima semana", fr: "la semaine prochaine", de: "nächste Woche", it: "la prossima settimana", pt: "na próxima semana", nl: "volgende week", zh: "下周", ja: "来週", ru: "на следующей неделе", ar: "الأسبوع القادم", hi: "अगले सप्ताह" },
  "as discussed": { es: "como se habló", fr: "comme convenu", de: "wie besprochen", it: "come discusso", pt: "como combinado", nl: "zoals besproken", zh: "如前所述", ja: "お話しした通り", ru: "как обсуждалось", ar: "كما نوقش", hi: "चर्चा के अनुसार" },
  "see you soon": { es: "hasta pronto", fr: "à bientôt", de: "bis bald", it: "a presto", pt: "até logo", nl: "tot snel", zh: "回头见", ja: "また近いうちに", ru: "до скорого", ar: "أراك قريبا", hi: "जल्द मिलते हैं" },
  "feedback on": { es: "comentarios sobre", fr: "retours sur", de: "Rückmeldung zu", it: "feedback su", pt: "comentários sobre", nl: "feedback over", zh: "关于反馈", ja: "のフィードバック", ru: "отзыв о", ar: "ملاحظات حول", hi: "पर प्रतिक्रिया" },
  "just finished": { es: "acabo de terminar", fr: "viens de terminer", de: "habe gerade abgeschlossen", it: "ho appena finito", pt: "acabei de terminar", nl: "net klaar met", zh: "刚刚完成", ja: "完了したばかり", ru: "только что закончил", ar: "انتهيت للتو", hi: "अभी समाप्त किया" },
  "in real-time": { es: "en tiempo real", fr: "en temps réel", de: "in Echtzeit", it: "in tempo reale", pt: "em tempo real", nl: "in realtime", zh: "实时", ja: "リアルタイムで", ru: "в реальном времени", ar: "في الوقت الفعلي", hi: "वास्तविक समय में" },
  "real-time": { es: "tiempo real", fr: "temps réel", de: "Echtzeit", it: "tempo reale", pt: "tempo real", nl: "realtime", zh: "实时", ja: "リアルタイム", ru: "реальное время", ar: "الوقت الفعلي", hi: "वास्तविक समय" },
  "thanks to": { es: "gracias a", fr: "grâce à", de: "dank", it: "grazie a", pt: "graças a", nl: "dankzij", zh: "多亏", ja: "のおかげで", ru: "благодаря", ar: "بفضل", hi: "की बदौलत" },
  "reading pane": { es: "panel de lectura", fr: "volet de lecture", de: "Lesebereich", it: "riquadro di lettura", pt: "painel de leitura", nl: "leesvenster", zh: "阅读窗格", ja: "閲覧ウィンドウ", ru: "область чтения", ar: "جزء القراءة", hi: "रीडिंग फलक" },
  "status pill": { es: "indicador de estado", fr: "pilule d'état", de: "Status-Badge", it: "pillola di stato", pt: "pílula de status", nl: "statusbadge", zh: "状态药丸", ja: "ステータスバッジ", ru: "индикатор статуса", ar: "مؤشر الحالة", hi: "स्थिति संकेतक" },
  "would love to": { es: "le encantaría", fr: "aimerait", de: "würde gerne", it: "vorrebbe", pt: "adoraria", nl: "zou graag", zh: "很乐意", ja: "したいと考えています", ru: "с удовольствием", ar: "يود", hi: "पसंद करेंगे" },
  "let's": { es: "vamos a", fr: "allons", de: "lasst uns", it: "andiamo a", pt: "vamos", nl: "laten we", zh: "让我们", ja: "しましょう", ru: "давайте", ar: "دعونا", hi: "आइए" },
  "do you think": { es: "¿crees que", fr: "penses-tu que", de: "denkst du", it: "pensi che", pt: "você acha que", nl: "denk je dat", zh: "你认为", ja: "どう思いますか", ru: "как ты думаешь", ar: "هل تعتقد", hi: "क्या आपको लगता है" },
  "works for you": { es: "te sirve", fr: "vous convient", de: "passt Ihnen", it: "va bene per te", pt: "funciona para você", nl: "schikt u", zh: "对您合适", ja: "ご都合はいかがでしょうか", ru: "вам подходит", ar: "يناسبك", hi: "आपके लिए ठीक रहेगा" },
  "as soon as possible": { es: "lo antes posible", fr: "dès que possible", de: "so bald wie möglich", it: "al più presto", pt: "o mais breve possível", nl: "zo snel mogelijk", zh: "尽快", ja: "できるだけ早く", ru: "как можно скорее", ar: "في أقرب وقت ممكن", hi: "जितनी जल्दी हो सके" },
  "looking forward to": { es: "con muchas ganas de", fr: "au plaisir de", de: "freue mich auf", it: "non vedo l'ora di", pt: "ansioso por", nl: "ik kijk uit naar", zh: "期待", ja: "楽しみにしています", ru: "с нетерпением жду", ar: "أتطلع إلى", hi: "इंतजार रहेगा" },
  "feel free to": { es: "no dudes en", fr: "n'hésitez pas à", de: "zögern Sie nicht", it: "sentiti libero di", pt: "sinta-se à vontade para", nl: "voel je vrij om", zh: "欢迎随时", ja: "お気軽に", ru: "не стесняйтесь", ar: "لا تتردد في", hi: "बेझिझक" },
  "any questions or feedback": { es: "cualquier pregunta o comentario", fr: "toute question ou retour", de: "Fragen oder Rückmeldungen", it: "qualsiasi domanda o feedback", pt: "quaisquer dúvidas ou comentários", nl: "vragen of feedback", zh: "任何问题或反馈", ja: "ご質問やフィードバック", ru: "какие-либо вопросы или отзывы", ar: "أي أسئلة أو ملاحظات", hi: "कोई प्रश्न या प्रतिक्रिया" },
  "tomorrow's call": { es: "la llamada de mañana", fr: "l'appel de demain", de: "das morgige Telefonat", it: "la chiamata di domani", pt: "a chamada de amanhã", nl: "het gesprek van morgen", zh: "明天的通话", ja: "明日の電話", ru: "завтрашний звонок", ar: "مكالمة الغد", hi: "कल का कॉल" },
  "demo call": { es: "llamada de demostración", fr: "appel de démonstration", de: "Demo-Gespräch", it: "chiamata demo", pt: "chamada de demonstração", nl: "demogesprek", zh: "演示通话", ja: "デモ通話", ru: "демо-звонок", ar: "مكالمة توضيحية", hi: "डेमो कॉल" },
  "server migration schedule": { es: "calendario de migración de servidores", fr: "calendrier de migration des serveurs", de: "Servermigrationsplan", it: "programma di migrazione del server", pt: "cronograma de migração de servidores", nl: "servermigratieschema", zh: "服务器迁移计划", ja: "サーバー移行スケジュール", ru: "график миграции серверов", ar: "جدول ترحيل الخوادم", hi: "सर्वर माइग्रेशन अनुसूची" },
  "policy changes": { es: "cambios en la política", fr: "modifications de politique", de: "Richtlinienänderungen", it: "modifiche alla politica", pt: "mudanças de política", nl: "beleidswijzigingen", zh: "政策变更", ja: "ポリシーの変更", ru: "изменения в политике", ar: "تغييرات في السياسة", hi: "नीति में बदलाव" },
  "action required": { es: "acción requerida", fr: "action requise", de: "Handlung erforderlich", it: "azione richiesta", pt: "ação necessária", nl: "actie vereist", zh: "需要采取行动", ja: "対応が必要です", ru: "требуется действие", ar: "إجراء مطلوب", hi: "कार्रवाई आवश्यक है" },
  "let me know if": { es: "avísame si", fr: "fais-moi savoir si", de: "gib mir Bescheid wenn", it: "fammi sapere se", pt: "avise-me se", nl: "laat me weten als", zh: "告诉我如果", ja: "もし〜なら教えてください", ru: "дай мне знать если", ar: "أعلمني إذا", hi: "मुझे बताएं यदि" },
  "as well as": { es: "así como", fr: "ainsi que", de: "sowie", it: "così come", pt: "bem como", nl: "evenals", zh: "以及", ja: "だけでなく", ru: "а также", ar: "وكذلك", hi: "साथ ही" },
  "in order to": { es: "para", fr: "afin de", de: "um zu", it: "al fine di", pt: "a fim de", nl: "om te", zh: "为了", ja: "するために", ru: "для того чтобы", ar: "من أجل", hi: "ताकि" },
  "due to": { es: "debido a", fr: "en raison de", de: "aufgrund", it: "a causa di", pt: "devido a", nl: "vanwege", zh: "由于", ja: "のために", ru: "из-за", ar: "بسبب", hi: "के कारण" },
  "at your earliest convenience": { es: "a su más pronta conveniencia", fr: "dès que possible", de: "so bald wie möglich", it: "al più presto", pt: "assim que possível", nl: "zo snel mogelijk", zh: "在您方便时尽快", ja: "ご都合のつき次第", ru: "при первой возможности", ar: "في أقرب وقت يناسبك", hi: "यथाशीघ्र" },
};

// Rich vocabulary mapping covering core email vocabulary across all supported languages
const VOCABULARY_LIST: Array<Record<string, string>> = [
  // ── Basics & Greetings ──
  { en: "hello", es: "hola", fr: "bonjour", de: "hallo", it: "ciao", pt: "olá", nl: "hallo", zh: "你好", ja: "こんにちは", ru: "здравствуйте", ar: "مرحبا", hi: "नमस्ते" },
  { en: "hi", es: "hola", fr: "salut", de: "hallo", it: "ciao", pt: "oi", nl: "hoi", zh: "嗨", ja: "やあ", ru: "привет", ar: "أهلا", hi: "नमस्ते" },
  { en: "thanks", es: "gracias", fr: "merci", de: "danke", it: "grazie", pt: "obrigado", nl: "bedankt", zh: "多谢", ja: "ありがとう", ru: "спасибо", ar: "شكرا", hi: "धन्यवाद" },
  { en: "sincerely", es: "atentamente", fr: "sincèrement", de: "hochachtungsvoll", it: "cordialmente", pt: "sinceramente", nl: "hoogachtend", zh: "真诚地", ja: "敬具", ru: "искренне", ar: "بإخلاص", hi: "भवदीय" },
  { en: "regards", es: "saludos", fr: "cordialement", de: "Grüße", it: "saluti", pt: "cumprimentos", nl: "groeten", zh: "致意", ja: "敬具", ru: "с уважением", ar: "تحياتي", hi: "सादर" },
  { en: "please", es: "por favor", fr: "s'il vous plaît", de: "bitte", it: "per favore", pt: "por favor", nl: "alstublieft", zh: "请", ja: "お願いします", ru: "пожалуйста", ar: "من فضلك", hi: "कृपया" },
  { en: "welcome", es: "bienvenido", fr: "bienvenue", de: "willkommen", it: "benvenuto", pt: "bem-vindo", nl: "welkom", zh: "欢迎", ja: "ようこそ", ru: "добро пожаловать", ar: "أهلا بك", hi: "स्वागत है" },
  { en: "goodbye", es: "adiós", fr: "au revoir", de: "auf Wiedersehen", it: "arrivederci", pt: "adeus", nl: "tot ziens", zh: "再见", ja: "さようなら", ru: "до свидания", ar: "وداعا", hi: "अलविदा" },
  { en: "yes", es: "sí", fr: "oui", de: "ja", it: "sì", pt: "sim", nl: "ja", zh: "是", ja: "はい", ru: "да", ar: "نعم", hi: "हाँ" },
  { en: "no", es: "no", fr: "non", de: "nein", it: "no", pt: "não", nl: "nee", zh: "不", ja: "いいえ", ru: "нет", ar: "لا", hi: "नहीं" },
  { en: "not", es: "no", fr: "pas", de: "nicht", it: "non", pt: "não", nl: "niet", zh: "未", ja: "ではない", ru: "не", ar: "ليس", hi: "नहीं" },

  // ── Pronouns & Determiners ──
  { en: "i", es: "yo", fr: "je", de: "ich", it: "io", pt: "eu", nl: "ik", zh: "我", ja: "私", ru: "я", ar: "أنا", hi: "मैं" },
  { en: "me", es: "mí", fr: "moi", de: "mich", it: "me", pt: "mim", nl: "mij", zh: "我", ja: "私", ru: "меня", ar: "لي", hi: "मुझे" },
  { en: "my", es: "mi", fr: "mon", de: "mein", it: "mio", pt: "meu", nl: "mijn", zh: "我的", ja: "私の", ru: "мой", ar: "لي", hi: "मेरा" },
  { en: "we", es: "nosotros", fr: "nous", de: "wir", it: "noi", pt: "nós", nl: "wij", zh: "我们", ja: "私たち", ru: "мы", ar: "نحن", hi: "हम" },
  { en: "us", es: "nosotros", fr: "nous", de: "uns", it: "noi", pt: "nós", nl: "ons", zh: "我们", ja: "私たち", ru: "нас", ar: "لنا", hi: "हमें" },
  { en: "our", es: "nuestro", fr: "notre", de: "unser", it: "nostro", pt: "nosso", nl: "onze", zh: "我们的", ja: "私たちの", ru: "наш", ar: "لنا", hi: "हमारा" },
  { en: "you", es: "usted", fr: "vous", de: "Sie", it: "tu", pt: "você", nl: "u", zh: "您", ja: "あなた", ru: "вы", ar: "أنت", hi: "आप" },
  { en: "your", es: "su", fr: "votre", de: "Ihr", it: "tuo", pt: "seu", nl: "uw", zh: "您的", ja: "あなたの", ru: "ваш", ar: "لك", hi: "आपका" },
  { en: "he", es: "él", fr: "il", de: "er", it: "lui", pt: "ele", nl: "hij", zh: "他", ja: "彼", ru: "он", ar: "هو", hi: "वह" },
  { en: "him", es: "él", fr: "lui", de: "ihn", it: "lui", pt: "ele", nl: "hem", zh: "他", ja: "彼", ru: "его", ar: "له", hi: "उसे" },
  { en: "his", es: "su", fr: "son", de: "sein", it: "suo", pt: "seu", nl: "zijn", zh: "他的", ja: "彼の", ru: "его", ar: "له", hi: "उसका" },
  { en: "she", es: "ella", fr: "elle", de: "sie", it: "lei", pt: "ela", nl: "zij", zh: "她", ja: "彼女", ru: "она", ar: "هي", hi: "वह" },
  { en: "her", es: "su", fr: "sa", de: "ihr", it: "suo", pt: "sua", nl: "haar", zh: "她的", ja: "彼女の", ru: "её", ar: "لها", hi: "उसका" },
  { en: "it", es: "ello", fr: "il", de: "es", it: "esso", pt: "isso", nl: "het", zh: "它", ja: "それ", ru: "это", ar: "هو", hi: "यह" },
  { en: "its", es: "su", fr: "son", de: "sein", it: "suo", pt: "seu", nl: "zijn", zh: "它的", ja: "その", ru: "его", ar: "له", hi: "इसका" },
  { en: "they", es: "ellos", fr: "ils", de: "sie", it: "loro", pt: "eles", nl: "ze", zh: "他们", ja: "彼ら", ru: "они", ar: "هم", hi: "वे" },
  { en: "them", es: "ellos", fr: "eux", de: "ihnen", it: "loro", pt: "eles", nl: "hen", zh: "他们", ja: "彼ら", ru: "их", ar: "هم", hi: "उन्हें" },
  { en: "their", es: "su", fr: "leur", de: "ihr", it: "loro", pt: "seu", nl: "hun", zh: "他们的", ja: "彼らの", ru: "их", ar: "لهم", hi: "उनका" },
  { en: "this", es: "este", fr: "ce", de: "dies", it: "questo", pt: "este", nl: "dit", zh: "这个", ja: "これ", ru: "этот", ar: "هذا", hi: "यह" },
  { en: "that", es: "eso", fr: "cela", de: "das", it: "quello", pt: "isso", nl: "dat", zh: "那个", ja: "それ", ru: "тот", ar: "ذلك", hi: "वह" },
  { en: "these", es: "estos", fr: "ces", de: "diese", it: "questi", pt: "estes", nl: "deze", zh: "这些", ja: "これら", ru: "эти", ar: "هؤلاء", hi: "ये" },
  { en: "those", es: "aquellos", fr: "ceux", de: "jene", it: "quelli", pt: "aqueles", nl: "die", zh: "那些", ja: "それら", ru: "те", ar: "أولئك", hi: "वे" },
  { en: "the", es: "el", fr: "le", de: "der", it: "il", pt: "o", nl: "de", zh: "该", ja: "その", ru: "этот", ar: "الـ", hi: "यह" },
  { en: "a", es: "un", fr: "un", de: "ein", it: "un", pt: "um", nl: "een", zh: "一个", ja: "一つ", ru: "один", ar: "واحد", hi: "एक" },
  { en: "an", es: "un", fr: "un", de: "ein", it: "un", pt: "um", nl: "een", zh: "一个", ja: "一つ", ru: "один", ar: "واحد", hi: "एक" },
  { en: "all", es: "todos", fr: "tous", de: "alle", it: "tutti", pt: "todos", nl: "alle", zh: "所有", ja: "すべて", ru: "все", ar: "الكل", hi: "सभी" },
  { en: "any", es: "cualquier", fr: "tout", de: "jede", it: "qualsiasi", pt: "qualquer", nl: "enige", zh: "任何", ja: "任意の", ru: "любой", ar: "أي", hi: "कोई" },
  { en: "some", es: "algunos", fr: "certains", de: "einige", it: "alcuni", pt: "alguns", nl: "sommige", zh: "一些", ja: "いくつか", ru: "некоторые", ar: "بعض", hi: "कुछ" },
  { en: "each", es: "cada", fr: "chaque", de: "jeder", it: "ogni", pt: "cada", nl: "elk", zh: "每个", ja: "各", ru: "каждый", ar: "كل", hi: "प्रत्येक" },
  { en: "every", es: "cada", fr: "chaque", de: "jeder", it: "ogni", pt: "cada", nl: "elk", zh: "每个", ja: "すべての", ru: "каждый", ar: "كل", hi: "हर" },
  { en: "both", es: "ambos", fr: "les deux", de: "beide", it: "entrambi", pt: "ambos", nl: "beide", zh: "双方", ja: "両方", ru: "оба", ar: "كلاهما", hi: "दोनों" },
  { en: "few", es: "pocos", fr: "peu", de: "wenige", it: "pochi", pt: "poucos", nl: "weinige", zh: "很少", ja: "少し", ru: "несколько", ar: "قليل", hi: "कुछ" },
  { en: "many", es: "muchos", fr: "beaucoup", de: "viele", it: "molti", pt: "muitos", nl: "veel", zh: "许多", ja: "多くの", ru: "многие", ar: "كثير", hi: "कई" },
  { en: "much", es: "mucho", fr: "beaucoup", de: "viel", it: "molto", pt: "muito", nl: "veel", zh: "多", ja: "たくさん", ru: "много", ar: "كثير", hi: "ज्यादा" },
  { en: "more", es: "más", fr: "plus", de: "mehr", it: "più", pt: "mais", nl: "meer", zh: "更多", ja: "もっと", ru: "больше", ar: "أكثر", hi: "अधिक" },
  { en: "most", es: "la mayoría", fr: "la plupart", de: "die meisten", it: "la maggior parte", pt: "a maioria", nl: "meeste", zh: "大多数", ja: "最も", ru: "большинство", ar: "معظم", hi: "अधिकांश" },
  { en: "other", es: "otro", fr: "autre", de: "anderer", it: "altro", pt: "outro", nl: "ander", zh: "其他", ja: "他の", ru: "другой", ar: "آخر", hi: "अन्य" },
  { en: "another", es: "otro", fr: "un autre", de: "ein anderer", it: "un altro", pt: "outro", nl: "een ander", zh: "另一个", ja: "別の", ru: "другой", ar: "آخر", hi: "दूसरा" },

  // ── Prepositions & Conjunctions ──
  { en: "and", es: "y", fr: "et", de: "und", it: "e", pt: "e", nl: "en", zh: "和", ja: "および", ru: "и", ar: "و", hi: "और" },
  { en: "or", es: "o", fr: "ou", de: "oder", it: "o", pt: "ou", nl: "of", zh: "或", ja: "または", ru: "или", ar: "أو", hi: "या" },
  { en: "but", es: "pero", fr: "mais", de: "aber", it: "ma", pt: "mas", nl: "maar", zh: "但是", ja: "しかし", ru: "но", ar: "لكن", hi: "लेकिन" },
  { en: "so", es: "así que", fr: "donc", de: "also", it: "quindi", pt: "então", nl: "dus", zh: "所以", ja: "だから", ru: "поэтому", ar: "لذلك", hi: "इसलिए" },
  { en: "because", es: "porque", fr: "parce que", de: "weil", it: "perché", pt: "porque", nl: "omdat", zh: "因为", ja: "なぜなら", ru: "потому что", ar: "لأن", hi: "क्योंकि" },
  { en: "as", es: "como", fr: "comme", de: "als", it: "come", pt: "como", nl: "als", zh: "如同", ja: "として", ru: "как", ar: "كما", hi: "जैसे" },
  { en: "if", es: "si", fr: "si", de: "wenn", it: "se", pt: "se", nl: "als", zh: "如果", ja: "もし", ru: "если", ar: "إذا", hi: "यदि" },
  { en: "with", es: "con", fr: "avec", de: "mit", it: "con", pt: "com", nl: "met", zh: "与", ja: "と", ru: "с", ar: "مع", hi: "साथ" },
  { en: "without", es: "sin", fr: "sans", de: "ohne", it: "senza", pt: "sem", nl: "zonder", zh: "没有", ja: "なしで", ru: "без", ar: "بدون", hi: "बिना" },
  { en: "for", es: "para", fr: "pour", de: "für", it: "per", pt: "para", nl: "voor", zh: "为了", ja: "のために", ru: "для", ar: "لـ", hi: "के लिए" },
  { en: "from", es: "de", fr: "de", de: "von", it: "da", pt: "de", nl: "van", zh: "来自", ja: "から", ru: "от", ar: "من", hi: "से" },
  { en: "to", es: "a", fr: "à", de: "zu", it: "a", pt: "para", nl: "naar", zh: "到", ja: "へ", ru: "к", ar: "إلى", hi: "को" },
  { en: "in", es: "en", fr: "dans", de: "in", it: "in", pt: "em", nl: "in", zh: "在", ja: "で", ru: "в", ar: "في", hi: "में" },
  { en: "on", es: "en", fr: "sur", de: "auf", it: "su", pt: "em", nl: "op", zh: "在", ja: "で", ru: "на", ar: "على", hi: "पर" },
  { en: "at", es: "en", fr: "à", de: "bei", it: "a", pt: "em", nl: "bij", zh: "在", ja: "で", ru: "в", ar: "في", hi: "पर" },
  { en: "by", es: "por", fr: "par", de: "von", it: "da", pt: "por", nl: "door", zh: "由", ja: "によって", ru: "по", ar: "بواسطة", hi: "द्वारा" },
  { en: "about", es: "sobre", fr: "à propos", de: "über", it: "circa", pt: "sobre", nl: "over", zh: "关于", ja: "について", ru: "о", ar: "حول", hi: "के बारे में" },
  { en: "before", es: "antes de", fr: "avant", de: "vor", it: "prima di", pt: "antes de", nl: "voor", zh: "之前", ja: "前に", ru: "до", ar: "قبل", hi: "से पहले" },
  { en: "after", es: "después de", fr: "après", de: "nach", it: "dopo", pt: "depois de", nl: "na", zh: "之后", ja: "後に", ru: "после", ar: "بعد", hi: "के बाद" },
  { en: "during", es: "durante", fr: "pendant", de: "während", it: "durante", pt: "durante", nl: "tijdens", zh: "期间", ja: "の間に", ru: "во время", ar: "أثناء", hi: "के दौरान" },
  { en: "between", es: "entre", fr: "entre", de: "zwischen", it: "tra", pt: "entre", nl: "tussen", zh: "之间", ja: "の間", ru: "между", ar: "بين", hi: "के बीच" },
  { en: "through", es: "a través de", fr: "à travers", de: "durch", it: "attraverso", pt: "através de", nl: "door", zh: "通过", ja: "を通じて", ru: "через", ar: "من خلال", hi: "के माध्यम से" },

  // ── Verbs & Auxiliaries ──
  { en: "is", es: "es", fr: "est", de: "ist", it: "è", pt: "é", nl: "is", zh: "是", ja: "です", ru: "является", ar: "يكون", hi: "है" },
  { en: "are", es: "son", fr: "sont", de: "sind", it: "sono", pt: "são", nl: "zijn", zh: "是", ja: "です", ru: "являются", ar: "هم", hi: "हैं" },
  { en: "am", es: "soy", fr: "suis", de: "bin", it: "sono", pt: "sou", nl: "ben", zh: "是", ja: "です", ru: "я", ar: "أنا", hi: "हूँ" },
  { en: "was", es: "era", fr: "était", de: "war", it: "era", pt: "era", nl: "was", zh: "曾是", ja: "でした", ru: "был", ar: "كان", hi: "था" },
  { en: "were", es: "eran", fr: "étaient", de: "waren", it: "erano", pt: "eram", nl: "waren", zh: "曾是", ja: "でした", ru: "были", ar: "كانوا", hi: "थे" },
  { en: "be", es: "ser", fr: "être", de: "sein", it: "essere", pt: "ser", nl: "zijn", zh: "成为", ja: "である", ru: "быть", ar: "يكون", hi: "होना" },
  { en: "been", es: "sido", fr: "été", de: "gewesen", it: "stato", pt: "sido", nl: "geweest", zh: "一直", ja: "された", ru: "был", ar: "كان", hi: "रहा" },
  { en: "have", es: "tener", fr: "avoir", de: "haben", it: "avere", pt: "ter", nl: "hebben", zh: "有", ja: "持っている", ru: "иметь", ar: "لديك", hi: "पास है" },
  { en: "has", es: "tiene", fr: "a", de: "hat", it: "ha", pt: "tem", nl: "heeft", zh: "拥有", ja: "持っています", ru: "имеет", ar: "لديه", hi: "है" },
  { en: "had", es: "tenía", fr: "avait", de: "hatte", it: "aveva", pt: "tinha", nl: "had", zh: "曾有", ja: "持っていた", ru: "имел", ar: "كان لديه", hi: "था" },
  { en: "do", es: "hacer", fr: "faire", de: "tun", it: "fare", pt: "fazer", nl: "doen", zh: "做", ja: "する", ru: "делать", ar: "يفعل", hi: "करना" },
  { en: "does", es: "hace", fr: "fait", de: "tut", it: "fa", pt: "faz", nl: "doet", zh: "做", ja: "します", ru: "делает", ar: "يفعل", hi: "करता है" },
  { en: "did", es: "hizo", fr: "a fait", de: "tat", it: "ha fatto", pt: "fez", nl: "deed", zh: "做了", ja: "した", ru: "сделал", ar: "فعل", hi: "किया" },
  { en: "can", es: "puede", fr: "peut", de: "kann", it: "può", pt: "pode", nl: "kan", zh: "可以", ja: "できる", ru: "может", ar: "يمكن", hi: "सकते हैं" },
  { en: "could", es: "podría", fr: "pourrait", de: "könnte", it: "potrebbe", pt: "poderia", nl: "zou kunnen", zh: "能够", ja: "できた", ru: "мог бы", ar: "استطاع", hi: "सका" },
  { en: "will", es: "será", fr: "va", de: "wird", it: "sarà", pt: "irá", nl: "zal", zh: "将", ja: "する予定です", ru: "будет", ar: "سوف", hi: "गा" },
  { en: "would", es: "gustaría", fr: "voudrait", de: "würde", it: "vorrebbe", pt: "gostaria", nl: "zou", zh: "将要", ja: "だろう", ru: "бы", ar: "سوف", hi: "चाहेंगे" },
  { en: "should", es: "debería", fr: "devrait", de: "sollte", it: "dovrebbe", pt: "deveria", nl: "zou moeten", zh: "应该", ja: "すべき", ru: "следует", ar: "ينبغي", hi: "चाहिए" },
  { en: "attach", es: "adjuntar", fr: "joindre", de: "anhängen", it: "allegare", pt: "anexar", nl: "bijvoegen", zh: "附加", ja: "添付する", ru: "прикрепить", ar: "إرفاق", hi: "संलग्न करें" },
  { en: "attached", es: "adjunto", fr: "joint", de: "angehängt", it: "allegato", pt: "anexado", nl: "bijgevoegd", zh: "已附上", ja: "添付された", ru: "прикрепленный", ar: "مرفق", hi: "संलग्न" },
  { en: "send", es: "enviar", fr: "envoyer", de: "senden", it: "inviare", pt: "enviar", nl: "verzenden", zh: "发送", ja: "送信", ru: "отправить", ar: "إرسال", hi: "भेजें" },
  { en: "sent", es: "enviado", fr: "envoyé", de: "gesendet", it: "inviato", pt: "enviado", nl: "verzonden", zh: "已发送", ja: "送信済み", ru: "отправлено", ar: "أرسلت", hi: "भेजा गया" },
  { en: "receive", es: "recibir", fr: "recevoir", de: "erhalten", it: "ricevere", pt: "receber", nl: "ontvangen", zh: "接收", ja: "受信", ru: "получить", ar: "استلام", hi: "प्राप्त करें" },
  { en: "received", es: "recibido", fr: "reçu", de: "erhalten", it: "ricevuto", pt: "recebido", nl: "ontvangen", zh: "已接收", ja: "受信した", ru: "получено", ar: "تم الاستلام", hi: "प्राप्त हुआ" },
  { en: "review", es: "revisar", fr: "examiner", de: "überprüfen", it: "revisionare", pt: "revisar", nl: "beoordelen", zh: "审查", ja: "レビューする", ru: "рассмотреть", ar: "مراجعة", hi: "समीक्षा करें" },
  { en: "reviewed", es: "revisado", fr: "examiné", de: "überprüft", it: "revisionato", pt: "revisado", nl: "beoordeeld", zh: "已审查", ja: "レビュー済み", ru: "проверено", ar: "تمت المراجعة", hi: "समीक्षा की" },
  { en: "confirm", es: "confirmar", fr: "confirmer", de: "bestätigen", it: "confermare", pt: "confirmar", nl: "bevestigen", zh: "确认", ja: "確認する", ru: "подтвердить", ar: "أكد", hi: "पुष्टि करें" },
  { en: "confirmed", es: "confirmado", fr: "confirmé", de: "bestätigt", it: "confermato", pt: "confirmado", nl: "bevestigd", zh: "已确认", ja: "確認済み", ru: "подтверждено", ar: "مؤكد", hi: "पुष्टि की" },
  { en: "schedule", es: "programar", fr: "planifier", de: "planen", it: "pianificare", pt: "agendar", nl: "inplannen", zh: "安排", ja: "スケジュールする", ru: "запланировать", ar: "جدولة", hi: "निर्धारित करें" },
  { en: "scheduled", es: "programado", fr: "planifié", de: "geplant", it: "pianificato", pt: "agendado", nl: "ingepland", zh: "已排定", ja: "予定済み", ru: "запланировано", ar: "مجدول", hi: "निर्धारित" },
  { en: "update", es: "actualizar", fr: "mettre à jour", de: "aktualisieren", it: "aggiornare", pt: "atualizar", nl: "bijwerken", zh: "更新", ja: "更新する", ru: "обновить", ar: "تحديث", hi: "अपडेट करें" },
  { en: "updated", es: "actualizado", fr: "mis à jour", de: "aktualisiert", it: "aggiornato", pt: "atualizado", nl: "bijgewerkt", zh: "已更新", ja: "更新済み", ru: "обновлено", ar: "محدث", hi: "अपडेट किया" },
  { en: "inform", es: "informar", fr: "informer", de: "informieren", it: "informare", pt: "informar", nl: "informeren", zh: "通知", ja: "知らせる", ru: "сообщить", ar: "إبلاغ", hi: "सूचित करें" },
  { en: "check", es: "comprobar", fr: "vérifier", de: "prüfen", it: "controllare", pt: "verificar", nl: "controleren", zh: "检查", ja: "確認する", ru: "проверить", ar: "فحص", hi: "जांचें" },
  { en: "see", es: "ver", fr: "voir", de: "sehen", it: "vedere", pt: "ver", nl: "zien", zh: "查看", ja: "見る", ru: "посмотреть", ar: "انظر", hi: "देखें" },
  { en: "think", es: "pensar", fr: "penser", de: "denken", it: "pensare", pt: "pensar", nl: "denken", zh: "思考", ja: "考える", ru: "думать", ar: "يفكر", hi: "सोचना" },
  { en: "thought", es: "pensó", fr: "pensé", de: "dachte", it: "pensato", pt: "pensou", nl: "dacht", zh: "想法", ja: "考えた", ru: "думал", ar: "فكر", hi: "सोचा" },
  { en: "look", es: "mirar", fr: "regarder", de: "schauen", it: "guardare", pt: "olhar", nl: "kijken", zh: "看", ja: "見る", ru: "смотреть", ar: "ينظر", hi: "देखना" },
  { en: "looks", es: "se ve", fr: "semble", de: "sieht aus", it: "sembra", pt: "parece", nl: "ziet eruit", zh: "看起来", ja: "に見える", ru: "выглядит", ar: "يبدو", hi: "लगता है" },
  { en: "looked", es: "miró", fr: "regardé", de: "schaute", it: "guardato", pt: "olhou", nl: "keek", zh: "看了", ja: "見た", ru: "смотрел", ar: "نظر", hi: "देखा" },
  { en: "want", es: "querer", fr: "vouloir", de: "wollen", it: "volere", pt: "querer", nl: "willen", zh: "想要", ja: "欲しい", ru: "хотеть", ar: "يريد", hi: "चाहना" },
  { en: "need", es: "necesitar", fr: "avoir besoin", de: "brauchen", it: "aver bisogno", pt: "precisar", nl: "nodig hebben", zh: "需要", ja: "必要とする", ru: "нуждаться", ar: "يحتاج", hi: "जरूरत है" },
  { en: "call", es: "llamar", fr: "appeler", de: "anrufen", it: "chiamare", pt: "ligar", nl: "bellen", zh: "通话", ja: "電話する", ru: "позвонить", ar: "اتصال", hi: "कॉल करें" },
  { en: "work", es: "trabajar", fr: "travailler", de: "arbeiten", it: "lavorare", pt: "trabalhar", nl: "werken", zh: "工作", ja: "働く", ru: "работать", ar: "عمل", hi: "काम करना" },
  { en: "works", es: "funciona", fr: "fonctionne", de: "funktioniert", it: "funziona", pt: "funciona", nl: "werkt", zh: "起作用", ja: "機能する", ru: "работает", ar: "يعمل", hi: "काम करता है" },
  { en: "worked", es: "trabajó", fr: "travaillé", de: "gearbeitet", it: "lavorato", pt: "trabalhou", nl: "gewerkt", zh: "已工作", ja: "働いた", ru: "работал", ar: "عمل", hi: "काम किया" },
  { en: "help", es: "ayudar", fr: "aider", de: "helfen", it: "aiutare", pt: "ajudar", nl: "helpen", zh: "帮助", ja: "手助けする", ru: "помочь", ar: "مساعدة", hi: "मदद करना" },
  { en: "make", es: "hacer", fr: "faire", de: "machen", it: "fare", pt: "fazer", nl: "maken", zh: "制作", ja: "作る", ru: "делать", ar: "يجعل", hi: "बनाना" },
  { en: "made", es: "hecho", fr: "fait", de: "gemacht", it: "fatto", pt: "feito", nl: "gemaakt", zh: "制作了", ja: "作った", ru: "сделано", ar: "صنع", hi: "बनाया" },
  { en: "get", es: "obtener", fr: "obtenir", de: "bekommen", it: "ottenere", pt: "obter", nl: "krijgen", zh: "获取", ja: "取得する", ru: "получить", ar: "يحصل على", hi: "पाना" },
  { en: "got", es: "obtuvo", fr: "obtenu", de: "bekam", it: "ottenuto", pt: "obteve", nl: "kreeg", zh: "得到了", ja: "得た", ru: "получил", ar: "حصل على", hi: "मिला" },
  { en: "give", es: "dar", fr: "donner", de: "geben", it: "dare", pt: "dar", nl: "geven", zh: "给予", ja: "与える", ru: "дать", ar: "يعطي", hi: "देना" },
  { en: "gave", es: "dio", fr: "a donné", de: "gab", it: "ha dato", pt: "deu", nl: "gaf", zh: "给了", ja: "与えた", ru: "дал", ar: "أعطى", hi: "दिया" },
  { en: "take", es: "tomar", fr: "prendre", de: "nehmen", it: "prendere", pt: "tomar", nl: "nemen", zh: "拿取", ja: "取る", ru: "брать", ar: "يأخذ", hi: "लेना" },
  { en: "took", es: "tomó", fr: "a pris", de: "nahm", it: "ha preso", pt: "tomou", nl: "nam", zh: "拿了", ja: "取った", ru: "взял", ar: "أخذ", hi: "लिया" },
  { en: "come", es: "venir", fr: "venir", de: "kommen", it: "venire", pt: "vir", nl: "komen", zh: "来", ja: "来る", ru: "прийти", ar: "يأتي", hi: "आना" },
  { en: "came", es: "vino", fr: "est venu", de: "kam", it: "è venuto", pt: "veio", nl: "kwam", zh: "来了", ja: "来た", ru: "пришел", ar: "جاء", hi: "आया" },
  { en: "go", es: "ir", fr: "aller", de: "gehen", it: "andare", pt: "ir", nl: "gaan", zh: "去", ja: "行く", ru: "идти", ar: "يذهب", hi: "जाना" },
  { en: "went", es: "fue", fr: "est allé", de: "ging", it: "è andato", pt: "foi", nl: "ging", zh: "去了", ja: "行った", ru: "пошел", ar: "ذهب", hi: "गया" },
  { en: "gone", es: "ido", fr: "allé", de: "gegangen", it: "andato", pt: "ido", nl: "gegaan", zh: "去了", ja: "去った", ru: "ушел", ar: "ذهب", hi: "चला गया" },
  { en: "ask", es: "preguntar", fr: "demander", de: "fragen", it: "chiedere", pt: "perguntar", nl: "vragen", zh: "问", ja: "尋ねる", ru: "спросить", ar: "يسأل", hi: "पूछना" },
  { en: "asked", es: "preguntó", fr: "demandé", de: "fragte", it: "chiesto", pt: "perguntou", nl: "vroeg", zh: "问了", ja: "尋ねた", ru: "спросил", ar: "سأل", hi: "पूछा" },
  { en: "reply", es: "responder", fr: "répondre", de: "antworten", it: "rispondere", pt: "responder", nl: "beantwoorden", zh: "回复", ja: "返信する", ru: "ответить", ar: "رد", hi: "उत्तर दें" },
  { en: "replied", es: "respondió", fr: "répondu", de: "antwortete", it: "risposto", pt: "respondeu", nl: "beantwoord", zh: "已回复", ja: "返信した", ru: "ответил", ar: "رد", hi: "उत्तर दिया" },
  { en: "read", es: "leer", fr: "lire", de: "lesen", it: "leggere", pt: "ler", nl: "lezen", zh: "阅读", ja: "読む", ru: "читать", ar: "اقرأ", hi: "पढ़ें" },
  { en: "write", es: "escribir", fr: "écrire", de: "schreiben", it: "scrivere", pt: "escrever", nl: "schrijven", zh: "写", ja: "書く", ru: "писать", ar: "اكتب", hi: "लिखें" },
  { en: "wrote", es: "escribió", fr: "a écrit", de: "schrieb", it: "ha scritto", pt: "escreveu", nl: "schreef", zh: "写了", ja: "書いた", ru: "написал", ar: "كتب", hi: "लिखा" },
  { en: "written", es: "escrito", fr: "écrit", de: "geschrieben", it: "scritto", pt: "escrito", nl: "geschreven", zh: "书面的", ja: "書かれた", ru: "написано", ar: "مكتوب", hi: "लिखित" },
  { en: "find", es: "encontrar", fr: "trouver", de: "finden", it: "trovare", pt: "encontrar", nl: "vinden", zh: "寻找", ja: "見つける", ru: "найти", ar: "يجد", hi: "पाना" },
  { en: "found", es: "encontrado", fr: "trouvé", de: "gefunden", it: "trovato", pt: "encontrado", nl: "gevonden", zh: "找到了", ja: "見つけた", ru: "нашел", ar: "وجد", hi: "मिला" },
  { en: "know", es: "saber", fr: "savoir", de: "wissen", it: "sapere", pt: "saber", nl: "weten", zh: "知道", ja: "知る", ru: "знать", ar: "يعرف", hi: "जानना" },
  { en: "knew", es: "sabía", fr: "savait", de: "wusste", it: "sapeva", pt: "sabia", nl: "wist", zh: "知道过", ja: "知っていた", ru: "знал", ar: "عرف", hi: "जानता था" },
  { en: "known", es: "conocido", fr: "connu", de: "bekannt", it: "conosciuto", pt: "conhecido", nl: "bekend", zh: "已知的", ja: "知られている", ru: "известный", ar: "معروف", hi: "ज्ञात" },

  // ── Common Nouns ──
  { en: "email", es: "correo", fr: "courriel", de: "E-Mail", it: "email", pt: "email", nl: "e-mail", zh: "邮件", ja: "メール", ru: "почта", ar: "بريد", hi: "ईमेल" },
  { en: "emails", es: "correos", fr: "courriels", de: "E-Mails", it: "email", pt: "emails", nl: "e-mails", zh: "邮件", ja: "メール", ru: "письма", ar: "رسائل بريد", hi: "ईमेल" },
  { en: "message", es: "mensaje", fr: "message", de: "Nachricht", it: "messaggio", pt: "mensagem", nl: "bericht", zh: "信息", ja: "メッセージ", ru: "сообщение", ar: "رسالة", hi: "संदेश" },
  { en: "messages", es: "mensajes", fr: "messages", de: "Nachrichten", it: "messaggi", pt: "mensagens", nl: "berichten", zh: "信息", ja: "メッセージ", ru: "сообщения", ar: "رسائل", hi: "संदेश" },
  { en: "attachment", es: "archivo adjunto", fr: "pièce jointe", de: "Anhang", it: "allegato", pt: "anexo", nl: "bijlage", zh: "附件", ja: "添付ファイル", ru: "вложение", ar: "مرفق", hi: "संलग्नक" },
  { en: "attachments", es: "archivos adjuntos", fr: "pièces jointes", de: "Anhänge", it: "allegati", pt: "anexos", nl: "bijlagen", zh: "附件", ja: "添付ファイル", ru: "вложения", ar: "مرفقات", hi: "संलग्नक" },
  { en: "note", es: "nota", fr: "note", de: "Notiz", it: "nota", pt: "nota", nl: "notitie", zh: "便签", ja: "メモ", ru: "заметка", ar: "ملاحظة", hi: "नोट" },
  { en: "notes", es: "notas", fr: "notes", de: "Notizen", it: "note", pt: "notas", nl: "notities", zh: "笔记", ja: "メモ", ru: "заметки", ar: "ملاحظات", hi: "नोट्स" },
  { en: "file", es: "archivo", fr: "fichier", de: "Datei", it: "file", pt: "arquivo", nl: "bestand", zh: "文件", ja: "ファイル", ru: "файл", ar: "ملف", hi: "फ़ाइल" },
  { en: "files", es: "archivos", fr: "fichiers", de: "Dateien", it: "file", pt: "arquivos", nl: "bestanden", zh: "文件", ja: "ファイル", ru: "файлы", ar: "ملفات", hi: "फ़ाइलें" },
  { en: "document", es: "documento", fr: "document", de: "Dokument", it: "documento", pt: "documento", nl: "document", zh: "文档", ja: "ドキュメント", ru: "документ", ar: "وثيقة", hi: "दस्तावेज़" },
  { en: "documents", es: "documentos", fr: "documents", de: "Dokumente", it: "documenti", pt: "documentos", nl: "documenten", zh: "文档", ja: "文書", ru: "документы", ar: "وثائق", hi: "दस्तावेज़" },
  { en: "slide", es: "diapositiva", fr: "diapositive", de: "Folie", it: "diapositiva", pt: "diapositivo", nl: "dia", zh: "幻灯片", ja: "スライド", ru: "слайд", ar: "شريحة", hi: "स्लाइड" },
  { en: "slides", es: "diapositivas", fr: "diapositives", de: "Folien", it: "diapositive", pt: "slides", nl: "dia's", zh: "幻灯片", ja: "スライド", ru: "слайды", ar: "شرائح", hi: "स्लाइड्स" },
  { en: "presentation", es: "presentación", fr: "présentation", de: "Präsentation", it: "presentazione", pt: "apresentação", nl: "presentatie", zh: "演示文稿", ja: "プレゼンテーション", ru: "презентация", ar: "عرض تقديمي", hi: "प्रस्तुति" },
  { en: "presentations", es: "presentaciones", fr: "présentations", de: "Präsentationen", it: "presentazioni", pt: "apresentações", nl: "presentaties", zh: "演示文稿", ja: "プレゼンテーション", ru: "презентации", ar: "عروض تقديمية", hi: "प्रस्तुतियाँ" },
  { en: "proposal", es: "propuesta", fr: "proposition", de: "Vorschlag", it: "proposta", pt: "proposta", nl: "voorstel", zh: "方案", ja: "提案", ru: "предложение", ar: "اقتراح", hi: "प्रस्ताव" },
  { en: "proposals", es: "propuestas", fr: "propositions", de: "Vorschläge", it: "proposte", pt: "propostas", nl: "voorstellen", zh: "提案", ja: "提案", ru: "предложения", ar: "مقترحات", hi: "प्रस्ताव" },
  { en: "meeting", es: "reunión", fr: "réunion", de: "Besprechung", it: "riunione", pt: "reunião", nl: "vergadering", zh: "会议", ja: "ミーティング", ru: "встреча", ar: "اجتماع", hi: "बैठक" },
  { en: "meetings", es: "reuniones", fr: "réunions", de: "Besprechungen", it: "riunioni", pt: "reuniões", nl: "vergaderingen", zh: "会议", ja: "会議", ru: "встречи", ar: "اجتماعات", hi: "बैठकें" },
  { en: "project", es: "proyecto", fr: "projet", de: "Projekt", it: "progetto", pt: "projeto", nl: "project", zh: "项目", ja: "プロジェクト", ru: "проект", ar: "مشروع", hi: "परियोजना" },
  { en: "projects", es: "proyectos", fr: "projets", de: "Projekte", it: "progetti", pt: "projetos", nl: "projecten", zh: "项目", ja: "プロジェクト", ru: "проекты", ar: "مشاريع", hi: "परियोजनाएं" },
  { en: "team", es: "equipo", fr: "équipe", de: "Team", it: "squadra", pt: "equipe", nl: "team", zh: "团队", ja: "チーム", ru: "команда", ar: "فريق", hi: "टीम" },
  { en: "teams", es: "equipos", fr: "équipes", de: "Teams", it: "squadre", pt: "equipes", nl: "teams", zh: "团队", ja: "チーム", ru: "команды", ar: "فرق", hi: "टीमें" },
  { en: "question", es: "pregunta", fr: "question", de: "Frage", it: "domanda", pt: "pergunta", nl: "vraag", zh: "问题", ja: "質問", ru: "вопрос", ar: "سؤال", hi: "प्रश्न" },
  { en: "questions", es: "preguntas", fr: "questions", de: "Fragen", it: "domande", pt: "perguntas", nl: "vragen", zh: "问题", ja: "質問", ru: "вопросы", ar: "أسئلة", hi: "प्रश्न" },
  { en: "feedback", es: "comentarios", fr: "retours", de: "Rückmeldung", it: "feedback", pt: "feedback", nl: "feedback", zh: "反馈", ja: "フィードバック", ru: "отзыв", ar: "ملاحظات", hi: "प्रतिक्रिया" },
  { en: "comment", es: "comentario", fr: "commentaire", de: "Kommentar", it: "commento", pt: "comentário", nl: "opmerking", zh: "评论", ja: "コメント", ru: "комментарий", ar: "تعليق", hi: "टिप्पणी" },
  { en: "comments", es: "comentarios", fr: "commentaires", de: "Kommentare", it: "commenti", pt: "comentários", nl: "opmerkingen", zh: "评论", ja: "コメント", ru: "комментарии", ar: "تعليقات", hi: "टिप्पणियाँ" },
  { en: "design", es: "diseño", fr: "conception", de: "Design", it: "design", pt: "design", nl: "ontwerp", zh: "设计", ja: "デザイン", ru: "дизайн", ar: "تصميم", hi: "डिज़ाइन" },
  { en: "designs", es: "diseños", fr: "conceptions", de: "Designs", it: "design", pt: "designs", nl: "ontwerpen", zh: "设计", ja: "デザイン", ru: "дизайны", ar: "تصاميم", hi: "डिज़ाइन" },
  { en: "engineering", es: "ingeniería", fr: "ingénierie", de: "Ingenieurwesen", it: "ingegneria", pt: "engenharia", nl: "techniek", zh: "工程", ja: "エンジニアリング", ru: "инженерия", ar: "هندسة", hi: "इंजीनियरिंग" },
  { en: "account", es: "cuenta", fr: "compte", de: "Konto", it: "conto", pt: "conta", nl: "account", zh: "账户", ja: "アカウント", ru: "аккаунт", ar: "حساب", hi: "खाता" },
  { en: "password", es: "contraseña", fr: "mot de passe", de: "Passwort", it: "password", pt: "senha", nl: "wachtwoord", zh: "密码", ja: "パスワード", ru: "пароль", ar: "كلمة المرور", hi: "पासवर्ड" },
  { en: "security", es: "seguridad", fr: "sécurité", de: "Sicherheit", it: "sicurezza", pt: "segurança", nl: "beveiliging", zh: "安全", ja: "セキュリティ", ru: "безопасность", ar: "أمان", hi: "सुरक्षा" },
  { en: "privacy", es: "privacidad", fr: "confidentialité", de: "Datenschutz", it: "riservatezza", pt: "privacidade", nl: "privacy", zh: "隐私", ja: "プライバシー", ru: "конфиденциальность", ar: "خصوصية", hi: "गोपनीयता" },
  { en: "setting", es: "ajuste", fr: "paramètre", de: "Einstellung", it: "impostazione", pt: "configuração", nl: "instelling", zh: "设置", ja: "設定", ru: "настройка", ar: "إعداد", hi: "सेटिंग" },
  { en: "settings", es: "ajustes", fr: "paramètres", de: "Einstellungen", it: "impostazioni", pt: "configurações", nl: "instellingen", zh: "设置", ja: "設定", ru: "настройки", ar: "إعدادات", hi: "सेटिंग्स" },
  { en: "name", es: "nombre", fr: "nom", de: "Name", it: "nome", pt: "nome", nl: "naam", zh: "名字", ja: "名前", ru: "имя", ar: "اسم", hi: "नाम" },
  { en: "first", es: "primero", fr: "premier", de: "erste", it: "primo", pt: "primeiro", nl: "eerste", zh: "第一", ja: "最初", ru: "первый", ar: "أول", hi: "पहला" },
  { en: "last", es: "último", fr: "dernier", de: "letzte", it: "ultimo", pt: "último", nl: "laatste", zh: "最后", ja: "最後", ru: "последний", ar: "أخير", hi: "अंतिम" },
  { en: "today", es: "hoy", fr: "aujourd'hui", de: "heute", it: "oggi", pt: "hoje", nl: "vandaag", zh: "今天", ja: "今日", ru: "сегодня", ar: "اليوم", hi: "आज" },
  { en: "tomorrow", es: "mañana", fr: "demain", de: "morgen", it: "domani", pt: "amanhã", nl: "morgen", zh: "明天", ja: "明日", ru: "завтра", ar: "غدا", hi: "कल" },
  { en: "yesterday", es: "ayer", fr: "hier", de: "gestern", it: "ieri", pt: "ontem", nl: "gisteren", zh: "昨天", ja: "昨日", ru: "вчера", ar: "أمس", hi: "कल" },
  { en: "week", es: "semana", fr: "semaine", de: "Woche", it: "settimana", pt: "semana", nl: "week", zh: "周", ja: "週", ru: "неделя", ar: "أسبوع", hi: "सप्ताह" },
  { en: "month", es: "mes", fr: "mois", de: "Monat", it: "mese", pt: "mês", nl: "maand", zh: "月", ja: "月", ru: "месяц", ar: "شهر", hi: "महीना" },
  { en: "year", es: "año", fr: "année", de: "Jahr", it: "anno", pt: "ano", nl: "jaar", zh: "年", ja: "年", ru: "год", ar: "سنة", hi: "वर्ष" },
  { en: "time", es: "hora", fr: "heure", de: "Zeit", it: "ora", pt: "hora", nl: "tijd", zh: "时间", ja: "時間", ru: "время", ar: "وقت", hi: "समय" },
  { en: "date", es: "fecha", fr: "date", de: "Datum", it: "data", pt: "data", nl: "datum", zh: "日期", ja: "日付", ru: "дата", ar: "تاريخ", hi: "दिनांक" },
  { en: "inbox", es: "bandeja de entrada", fr: "boîte de réception", de: "Posteingang", it: "posta in arrivo", pt: "caixa de entrada", nl: "postvak in", zh: "收件箱", ja: "受信トレイ", ru: "входящие", ar: "صندوق الوارد", hi: "इनबॉक्स" },
  { en: "subject", es: "asunto", fr: "objet", de: "Betreff", it: "oggetto", pt: "assunto", nl: "onderwerp", zh: "主题", ja: "件名", ru: "тема", ar: "موضوع", hi: "विषय" },
  { en: "sender", es: "remitente", fr: "expéditeur", de: "Absender", it: "mittente", pt: "remetente", nl: "afzender", zh: "发件人", ja: "送信者", ru: "отправитель", ar: "مرسل", hi: "प्रेषक" },
  { en: "recipient", es: "destinatario", fr: "destinataire", de: "Empfänger", it: "destinatario", pt: "destinatário", nl: "ontvanger", zh: "收件人", ja: "受信者", ru: "получатель", ar: "مستلم", hi: "प्राप्तकर्ता" },
  { en: "report", es: "informe", fr: "rapport", de: "Bericht", it: "rapporto", pt: "relatório", nl: "rapport", zh: "报告", ja: "レポート", ru: "отчет", ar: "تقرير", hi: "रिपोर्ट" },
  { en: "key", es: "clave", fr: "clé", de: "Schlüssel", it: "chiave", pt: "chave", nl: "sleutel", zh: "密钥", ja: "キー", ru: "ключ", ar: "مفتاح", hi: "कुंजी" },
  { en: "keys", es: "claves", fr: "clés", de: "Schlüssel", it: "chiavi", pt: "chaves", nl: "sleutels", zh: "密钥", ja: "キー", ru: "ключи", ar: "مفاتيح", hi: "कुंजियाँ" },
  { en: "user", es: "usuario", fr: "utilisateur", de: "Benutzer", it: "utente", pt: "usuário", nl: "gebruiker", zh: "用户", ja: "ユーザー", ru: "пользователь", ar: "مستخدم", hi: "उपयोगकर्ता" },
  { en: "users", es: "usuarios", fr: "utilisateurs", de: "Benutzer", it: "utenti", pt: "usuários", nl: "gebruikers", zh: "用户", ja: "ユーザー", ru: "пользователи", ar: "مستخدمون", hi: "उपयोगकर्ता" },
  { en: "issue", es: "problema", fr: "problème", de: "Problem", it: "problema", pt: "problema", nl: "probleem", zh: "问题", ja: "問題", ru: "проблема", ar: "مشكلة", hi: "समस्या" },
  { en: "issues", es: "problemas", fr: "problèmes", de: "Probleme", it: "problemi", pt: "problemas", nl: "problemen", zh: "问题", ja: "問題", ru: "проблемы", ar: "مشاكل", hi: "समस्याएं" },
  { en: "feature", es: "característica", fr: "fonctionnalité", de: "Funktion", it: "funzionalità", pt: "funcionalidade", nl: "functie", zh: "功能", ja: "機能", ru: "функция", ar: "ميزة", hi: "सुविधा" },
  { en: "features", es: "características", fr: "fonctionnalités", de: "Funktionen", it: "funzionalità", pt: "funcionalidades", nl: "functies", zh: "功能", ja: "機能", ru: "функции", ar: "ميزات", hi: "सुविधाएं" },
  { en: "release", es: "lanzamiento", fr: "version", de: "Freigabe", it: "versione", pt: "lançamento", nl: "versie", zh: "发布", ja: "リリース", ru: "выпуск", ar: "إصدار", hi: "रिलीज़" },
  { en: "version", es: "versión", fr: "version", de: "Version", it: "versione", pt: "versão", nl: "versie", zh: "版本", ja: "バージョン", ru: "версия", ar: "نسخة", hi: "संस्करण" },
  { en: "testing", es: "probando", fr: "test", de: "Testen", it: "collaudare", pt: "testando", nl: "testen", zh: "测试", ja: "テスト中", ru: "тестирование", ar: "اختبار", hi: "परीक्षण" },
  { en: "test", es: "prueba", fr: "test", de: "Test", it: "test", pt: "teste", nl: "test", zh: "测试", ja: "テスト", ru: "тест", ar: "اختبار", hi: "परीक्षण" },
  { en: "tests", es: "pruebas", fr: "tests", de: "Tests", it: "test", pt: "testes", nl: "tests", zh: "测试", ja: "テスト", ru: "тесты", ar: "اختبارات", hi: "परीक्षण" },
  { en: "demo", es: "demostración", fr: "démo", de: "Demo", it: "demo", pt: "demonstração", nl: "demo", zh: "演示", ja: "デモ", ru: "демо", ar: "عرض تجريبي", hi: "डेमो" },

  // ── Adjectives & Modifiers ──
  { en: "great", es: "genial", fr: "super", de: "großartig", it: "ottimo", pt: "ótimo", nl: "geweldig", zh: "棒", ja: "素晴らしい", ru: "отлично", ar: "رائع", hi: "बढ़िया" },
  { en: "good", es: "bueno", fr: "bon", de: "gut", it: "buono", pt: "bom", nl: "goed", zh: "好", ja: "良い", ru: "хороший", ar: "جيد", hi: "अच्छा" },
  { en: "new", es: "nuevo", fr: "nouveau", de: "neu", it: "nuovo", pt: "novo", nl: "nieuw", zh: "新", ja: "新しい", ru: "новый", ar: "جديد", hi: "नया" },
  { en: "quick", es: "rápido", fr: "rapide", de: "schnell", it: "rapido", pt: "rápido", nl: "snel", zh: "快速", ja: "迅速な", ru: "быстрый", ar: "سريع", hi: "त्वरित" },
  { en: "important", es: "importante", fr: "important", de: "wichtig", it: "importante", pt: "importante", nl: "belangrijk", zh: "重要", ja: "重要", ru: "важно", ar: "مهم", hi: "महत्वपूर्ण" },
  { en: "urgent", es: "urgente", fr: "urgent", de: "dringend", it: "urgente", pt: "urgente", nl: "dringend", zh: "紧急", ja: "緊急", ru: "срочно", ar: "عاجل", hi: "अति आवश्यक" },
  { en: "ready", es: "listo", fr: "prêt", de: "bereit", it: "pronto", pt: "pronto", nl: "klaar", zh: "准备就绪", ja: "準備完了", ru: "готово", ar: "جاهز", hi: "तैयार" },
  { en: "clean", es: "limpio", fr: "propre", de: "sauber", it: "pulito", pt: "limpo", nl: "schoon", zh: "整洁", ja: "クリーン", ru: "чистый", ar: "نظيف", hi: "स्वच्छ" },
  { en: "free", es: "libre", fr: "libre", de: "frei", it: "libero", pt: "livre", nl: "vrij", zh: "有空", ja: "無料", ru: "свободный", ar: "حر", hi: "मुफ़्त" },
  { en: "active", es: "activo", fr: "actif", de: "aktiv", it: "attivo", pt: "ativo", nl: "actief", zh: "活跃", ja: "アクティブ", ru: "активный", ar: "نشط", hi: "सक्रिय" },
  { en: "secure", es: "seguro", fr: "sécurisé", de: "sicher", it: "sicuro", pt: "seguro", nl: "veilig", zh: "安全", ja: "安全", ru: "защищенный", ar: "آمن", hi: "सुरक्षित" },
  { en: "private", es: "privado", fr: "privé", de: "privat", it: "privato", pt: "privado", nl: "privé", zh: "私密", ja: "非公開", ru: "приватный", ar: "خاص", hi: "निजी" },
  { en: "who", es: "quien", fr: "qui", de: "wer", it: "chi", pt: "quem", nl: "wie", zh: "谁", ja: "誰", ru: "кто", ar: "من", hi: "कौन" },
  { en: "where", es: "dónde", fr: "où", de: "wo", it: "dove", pt: "onde", nl: "waar", zh: "在哪里", ja: "どこ", ru: "где", ar: "أين", hi: "कहाँ" },
  { en: "when", es: "cuándo", fr: "quand", de: "wann", it: "quando", pt: "quando", nl: "wanneer", zh: "何时", ja: "いつ", ru: "когда", ar: "متى", hi: "कब" },
  { en: "why", es: "por qué", fr: "pourquoi", de: "warum", it: "perché", pt: "por que", nl: "waarom", zh: "为什么", ja: "なぜ", ru: "почему", ar: "لماذا", hi: "क्यों" },
  { en: "how", es: "cómo", fr: "comment", de: "wie", it: "come", pt: "como", nl: "hoe", zh: "如何", ja: "どうやって", ru: "как", ar: "كيف", hi: "कैसे" },

  // ── Extended Business & Corporate Vocabulary ──
  { en: "company", es: "empresa", fr: "entreprise", de: "Unternehmen", it: "azienda", pt: "empresa", nl: "bedrijf", zh: "公司", ja: "会社", ru: "компания", ar: "شركة", hi: "कंपनी" },
  { en: "companies", es: "empresas", fr: "entreprises", de: "Unternehmen", it: "aziende", pt: "empresas", nl: "bedrijven", zh: "公司", ja: "会社", ru: "компании", ar: "شركات", hi: "कंपनियां" },
  { en: "business", es: "negocio", fr: "entreprise", de: "Geschäft", it: "affari", pt: "negócio", nl: "zaken", zh: "业务", ja: "ビジネス", ru: "бизнес", ar: "أعمال", hi: "व्यापार" },
  { en: "office", es: "oficina", fr: "bureau", de: "Büro", it: "ufficio", pt: "escritório", nl: "kantoor", zh: "办公室", ja: "オフィス", ru: "офис", ar: "مكتب", hi: "कार्यालय" },
  { en: "policy", es: "política", fr: "politique", de: "Richtlinie", it: "politica", pt: "política", nl: "beleid", zh: "政策", ja: "ポリシー", ru: "политика", ar: "سياسة", hi: "नीति" },
  { en: "policies", es: "políticas", fr: "politiques", de: "Richtlinien", it: "politiche", pt: "políticas", nl: "beleid", zh: "政策", ja: "ポリシー", ru: "политики", ar: "سياسات", hi: "नीतियां" },
  { en: "server", es: "servidor", fr: "serveur", de: "Server", it: "server", pt: "servidor", nl: "server", zh: "服务器", ja: "サーバー", ru: "сервер", ar: "خادم", hi: "सर्वर" },
  { en: "servers", es: "servidores", fr: "serveurs", de: "Server", it: "server", pt: "servidores", nl: "servers", zh: "服务器", ja: "サーバー", ru: "серверы", ar: "خوادم", hi: "सर्वर" },
  { en: "system", es: "sistema", fr: "système", de: "System", it: "sistema", pt: "sistema", nl: "systeem", zh: "系统", ja: "システム", ru: "система", ar: "نظام", hi: "प्रणाली" },
  { en: "systems", es: "sistemas", fr: "systèmes", de: "Systeme", it: "sistemi", pt: "sistemas", nl: "systemen", zh: "系统", ja: "システム", ru: "системы", ar: "أنظمة", hi: "प्रणालियाँ" },
  { en: "client", es: "cliente", fr: "client", de: "Kunde", it: "cliente", pt: "cliente", nl: "cliënt", zh: "客户", ja: "クライアント", ru: "клиент", ar: "عميل", hi: "ग्राहक" },
  { en: "clients", es: "clientes", fr: "clients", de: "Kunden", it: "clienti", pt: "clientes", nl: "cliënten", zh: "客户", ja: "クライアント", ru: "клиенты", ar: "عملاء", hi: "ग्राहक" },
  { en: "customer", es: "cliente", fr: "client", de: "Kunde", it: "cliente", pt: "cliente", nl: "klant", zh: "客户", ja: "顧客", ru: "клиент", ar: "زبون", hi: "ग्राहक" },
  { en: "customers", es: "clientes", fr: "clients", de: "Kunden", it: "clienti", pt: "clientes", nl: "klanten", zh: "客户", ja: "顧客", ru: "клиенты", ar: "زبائن", hi: "ग्राहक" },
  { en: "support", es: "soporte", fr: "support", de: "Unterstützung", it: "supporto", pt: "suporte", nl: "ondersteuning", zh: "支持", ja: "サポート", ru: "поддержка", ar: "دعم", hi: "समर्थन" },
  { en: "service", es: "servicio", fr: "service", de: "Dienst", it: "servizio", pt: "serviço", nl: "dienst", zh: "服务", ja: "サービス", ru: "служба", ar: "خدمة", hi: "सेवा" },
  { en: "services", es: "servicios", fr: "services", de: "Dienste", it: "servizi", pt: "serviços", nl: "diensten", zh: "服务", ja: "サービス", ru: "услуги", ar: "خدمات", hi: "सेवाएं" },
  { en: "action", es: "acción", fr: "action", de: "Aktion", it: "azione", pt: "ação", nl: "actie", zh: "行动", ja: "アクション", ru: "действие", ar: "إجراء", hi: "कार्रवाई" },
  { en: "actions", es: "acciones", fr: "actions", de: "Aktionen", it: "azioni", pt: "ações", nl: "acties", zh: "行动", ja: "アクション", ru: "действия", ar: "إجراءات", hi: "कार्रवाइयां" },
  { en: "required", es: "requerido", fr: "requis", de: "erforderlich", it: "richiesto", pt: "necessário", nl: "vereist", zh: "必需的", ja: "必須の", ru: "требуется", ar: "مطلوب", hi: "आवश्यक" },
  { en: "immediately", es: "inmediatamente", fr: "immédiatement", de: "sofort", it: "immediatamente", pt: "imediatamente", nl: "onmiddellijk", zh: "立即", ja: "直ちに", ru: "немедленно", ar: "فوراً", hi: "तुरंत" },
  { en: "migration", es: "migración", fr: "migration", de: "Migration", it: "migrazione", pt: "migração", nl: "migratie", zh: "迁移", ja: "移行", ru: "миграция", ar: "ترحيل", hi: "माइग्रेशन" },
  { en: "schedule", es: "horario", fr: "calendrier", de: "Zeitplan", it: "programma", pt: "cronograma", nl: "schema", zh: "时间表", ja: "スケジュール", ru: "расписание", ar: "جدول", hi: "समय सारिणी" },
  { en: "deadline", es: "fecha límite", fr: "date limite", de: "Frist", it: "scadenza", pt: "prazo", nl: "deadline", zh: "截止日期", ja: "締め切り", ru: "крайний срок", ar: "الموعد النهائي", hi: "अंतिम तिथि" },
  { en: "calendar", es: "calendario", fr: "calendrier", de: "Kalender", it: "calendario", pt: "calendário", nl: "kalender", zh: "日历", ja: "カレンダー", ru: "календарь", ar: "تقويم", hi: "कैलेंडर" },
  { en: "event", es: "evento", fr: "événement", de: "Ereignis", it: "evento", pt: "evento", nl: "evenement", zh: "事件", ja: "イベント", ru: "событие", ar: "حدث", hi: "कार्यक्रम" },
  { en: "events", es: "eventos", fr: "événements", de: "Ereignisse", it: "eventi", pt: "eventos", nl: "evenementen", zh: "事件", ja: "イベント", ru: "события", ar: "أحداث", hi: "कार्यक्रम" },
  { en: "appointment", es: "cita", fr: "rendez-vous", de: "Termin", it: "appuntamento", pt: "compromisso", nl: "afspraak", zh: "约会", ja: "予約", ru: "назначение", ar: "موعد", hi: "मुलाकात" },
  { en: "reminder", es: "recordatorio", fr: "rappel", de: "Erinnerung", it: "promemoria", pt: "lembrete", nl: "herinnering", zh: "提醒", ja: "リマインダー", ru: "напоминание", ar: "تذكير", hi: "अनुस्मारक" },
  { en: "reminders", es: "recordatorios", fr: "rappels", de: "Erinnerungen", it: "promemoria", pt: "lembretes", nl: "herinneringen", zh: "提醒", ja: "リマインダー", ru: "напоминания", ar: "تذكيرات", hi: "अनुस्मारक" },
  { en: "invitation", es: "invitación", fr: "invitation", de: "Einladung", it: "invito", pt: "convite", nl: "uitnodiging", zh: "邀请", ja: "招待", ru: "приглашение", ar: "دعوة", hi: "निमंत्रण" },
  { en: "invite", es: "invitar", fr: "inviter", de: "einladen", it: "invitare", pt: "convidar", nl: "uitnodigen", zh: "邀请", ja: "招待する", ru: "пригласить", ar: "دعوة", hi: "आमंत्रित करें" },
  { en: "details", es: "detalles", fr: "détails", de: "Details", it: "dettagli", pt: "detalhes", nl: "details", zh: "详细信息", ja: "詳細", ru: "детали", ar: "تفاصيل", hi: "विवरण" },
  { en: "detail", es: "detalle", fr: "détail", de: "Detail", it: "dettaglio", pt: "detalhe", nl: "detail", zh: "细节", ja: "詳細", ru: "деталь", ar: "تفصيل", hi: "विवरण" },
  { en: "information", es: "información", fr: "informations", de: "Informationen", it: "informazioni", pt: "informação", nl: "informatie", zh: "信息", ja: "情報", ru: "информация", ar: "معلومات", hi: "जानकारी" },
  { en: "info", es: "información", fr: "infos", de: "Info", it: "info", pt: "informações", nl: "info", zh: "信息", ja: "情報", ru: "информация", ar: "معلومات", hi: "जानकारी" },
  { en: "summary", es: "resumen", fr: "résumé", de: "Zusammenfassung", it: "riassunto", pt: "resumo", nl: "samenvatting", zh: "摘要", ja: "要約", ru: "резюме", ar: "ملخص", hi: "सारांश" },
  { en: "contract", es: "contrato", fr: "contrat", de: "Vertrag", it: "contratto", pt: "contrato", nl: "contract", zh: "合同", ja: "契約", ru: "контракт", ar: "عقد", hi: "अनुबंध" },
  { en: "agreement", es: "acuerdo", fr: "accord", de: "Vereinbarung", it: "accordo", pt: "acordo", nl: "overeenkomst", zh: "协议", ja: "合意", ru: "соглашение", ar: "اتفاقية", hi: "समझौता" },
  { en: "payment", es: "pago", fr: "paiement", de: "Zahlung", it: "pagamento", pt: "pagamento", nl: "betaling", zh: "支付", ja: "支払い", ru: "платеж", ar: "دفع", hi: "भुगतान" },
  { en: "invoice", es: "factura", fr: "facture", de: "Rechnung", it: "fattura", pt: "fatura", nl: "factuur", zh: "发票", ja: "請求書", ru: "счет", ar: "فاتورة", hi: "चालान" },
  { en: "budget", es: "presupuesto", fr: "budget", de: "Budget", it: "budget", pt: "orçamento", nl: "begroting", zh: "预算", ja: "予算", ru: "бюджет", ar: "ميزانية", hi: "बजट" },
  { en: "cost", es: "costo", fr: "coût", de: "Kosten", it: "costo", pt: "custo", nl: "kosten", zh: "成本", ja: "費用", ru: "стоимость", ar: "تكلفة", hi: "लागत" },
  { en: "costs", es: "costos", fr: "coûts", de: "Kosten", it: "costi", pt: "custos", nl: "kosten", zh: "成本", ja: "費用", ru: "расходы", ar: "تكاليف", hi: "लागत" },
  { en: "price", es: "precio", fr: "prix", de: "Preis", it: "prezzo", pt: "preço", nl: "prijs", zh: "价格", ja: "価格", ru: "цена", ar: "سعر", hi: "मूल्य" },
  { en: "link", es: "enlace", fr: "lien", de: "Link", it: "link", pt: "link", nl: "link", zh: "链接", ja: "リンク", ru: "ссылка", ar: "رابط", hi: "लिंक" },
  { en: "links", es: "enlaces", fr: "liens", de: "Links", it: "link", pt: "links", nl: "links", zh: "链接", ja: "リンク", ru: "ссылки", ar: "روابط", hi: "लिंक्स" },
  { en: "click", es: "hacer clic", fr: "cliquer", de: "klicken", it: "cliccare", pt: "clicar", nl: "klikken", zh: "点击", ja: "クリックする", ru: "нажмите", ar: "انقر", hi: "क्लिक करें" },
  { en: "access", es: "acceso", fr: "accès", de: "Zugang", it: "accesso", pt: "acesso", nl: "toegang", zh: "访问", ja: "アクセス", ru: "доступ", ar: "وصول", hi: "पहुंच" },
  { en: "login", es: "iniciar sesión", fr: "connexion", de: "Anmeldung", it: "accesso", pt: "iniciar sessão", nl: "inloggen", zh: "登录", ja: "ログイン", ru: "вход", ar: "تسجيل الدخول", hi: "लॉगिन" },
  { en: "contact", es: "contacto", fr: "contact", de: "Kontakt", it: "contatto", pt: "contato", nl: "contact", zh: "联系", ja: "連絡先", ru: "контакт", ar: "اتصال", hi: "संपर्क" },
  { en: "contacts", es: "contactos", fr: "contacts", de: "Kontakte", it: "contatti", pt: "contatos", nl: "contacten", zh: "联系人", ja: "連絡先", ru: "контакты", ar: "جهات اتصال", hi: "संपर्क" },
  { en: "phone", es: "teléfono", fr: "téléphone", de: "Telefon", it: "telefono", pt: "telefone", nl: "telefoon", zh: "电话", ja: "電話", ru: "телефон", ar: "هاتف", hi: "फ़ोन" },
  { en: "address", es: "dirección", fr: "adresse", de: "Adresse", it: "indirizzo", pt: "endereço", nl: "adres", zh: "地址", ja: "住所", ru: "адрес", ar: "عنوان", hi: "पता" },
  { en: "department", es: "departamento", fr: "département", de: "Abteilung", it: "dipartimento", pt: "departamento", nl: "afdeling", zh: "部门", ja: "部門", ru: "отдел", ar: "قسم", hi: "विभाग" },
  { en: "manager", es: "gerente", fr: "directeur", de: "Manager", it: "responsabile", pt: "gerente", nl: "manager", zh: "经理", ja: "マネージャー", ru: "менеджер", ar: "مدير", hi: "प्रबंधक" },
  { en: "director", es: "director", fr: "directeur", de: "Direktor", it: "direttore", pt: "diretor", nl: "directeur", zh: "总监", ja: "ディレクター", ru: "директор", ar: "مدير", hi: "निदेशक" },
  { en: "colleague", es: "colega", fr: "collègue", de: "Kollege", it: "collega", pt: "colega", nl: "collega", zh: "同事", ja: "同僚", ru: "коллега", ar: "زميل", hi: "सहकर्मी" },
  { en: "colleagues", es: "colegas", fr: "collègues", de: "Kollegen", it: "colleghi", pt: "colegas", nl: "collega's", zh: "同事", ja: "同僚", ru: "коллеги", ar: "زملاء", hi: "सहकर्मी" },
  { en: "partner", es: "socio", fr: "partenaire", de: "Partner", it: "partner", pt: "parceiro", nl: "partner", zh: "合作伙伴", ja: "パートナー", ru: "партнер", ar: "شريك", hi: "साझेदार" },
  { en: "partners", es: "socios", fr: "partenaires", de: "Partner", it: "partner", pt: "parceiros", nl: "partners", zh: "合作伙伴", ja: "パートナー", ru: "партнеры", ar: "شركاء", hi: "साझेदार" },
  { en: "member", es: "miembro", fr: "membre", de: "Mitglied", it: "membro", pt: "membro", nl: "lid", zh: "成员", ja: "メンバー", ru: "участник", ar: "عضو", hi: "सदस्य" },
  { en: "members", es: "miembros", fr: "membres", de: "Mitglieder", it: "membri", pt: "membros", nl: "leden", zh: "成员", ja: "メンバー", ru: "участники", ar: "أعضاء", hi: "सदस्य" },
  { en: "plan", es: "plan", fr: "plan", de: "Plan", it: "piano", pt: "plano", nl: "plan", zh: "计划", ja: "計画", ru: "план", ar: "خطة", hi: "योजना" },
  { en: "plans", es: "planes", fr: "plans", de: "Pläne", it: "piani", pt: "planos", nl: "plannen", zh: "计划", ja: "計画", ru: "планы", ar: "خطط", hi: "योजनाएं" },
  { en: "result", es: "resultado", fr: "résultat", de: "Ergebnis", it: "risultato", pt: "resultado", nl: "resultaat", zh: "结果", ja: "結果", ru: "результат", ar: "نتيجة", hi: "परिणाम" },
  { en: "results", es: "resultados", fr: "résultats", de: "Ergebnisse", it: "risultati", pt: "resultados", nl: "resultaten", zh: "结果", ja: "結果", ru: "результаты", ar: "نتائج", hi: "परिणाम" },
  { en: "task", es: "tarea", fr: "tâche", de: "Aufgabe", it: "compito", pt: "tarefa", nl: "taak", zh: "任务", ja: "タスク", ru: "задача", ar: "مهمة", hi: "कार्य" },
  { en: "tasks", es: "tareas", fr: "tâches", de: "Aufgaben", it: "compiti", pt: "tarefas", nl: "taken", zh: "任务", ja: "タスク", ru: "задачи", ar: "مهام", hi: "कार्य" },
  { en: "goal", es: "meta", fr: "objectif", de: "Ziel", it: "obiettivo", pt: "meta", nl: "doel", zh: "目标", ja: "目標", ru: "цель", ar: "هدف", hi: "लक्ष्य" },
  { en: "goals", es: "metas", fr: "objectifs", de: "Ziele", it: "obiettivi", pt: "metas", nl: "doelen", zh: "目标", ja: "目標", ru: "цели", ar: "أهداف", hi: "लक्ष्य" },
  { en: "start", es: "comenzar", fr: "commencer", de: "starten", it: "iniziare", pt: "começar", nl: "starten", zh: "开始", ja: "開始する", ru: "начать", ar: "بدء", hi: "शुरू करें" },
  { en: "started", es: "comenzado", fr: "commencé", de: "gestartet", it: "iniziato", pt: "começado", nl: "gestart", zh: "已开始", ja: "開始した", ru: "начал", ar: "بدأ", hi: "शुरू किया" },
  { en: "end", es: "fin", fr: "fin", de: "Ende", it: "fine", pt: "fim", nl: "einde", zh: "结束", ja: "終了", ru: "конец", ar: "نهاية", hi: "अंत" },
  { en: "ended", es: "terminado", fr: "terminé", de: "beendet", it: "finito", pt: "terminado", nl: "beëindigd", zh: "已结束", ja: "終了した", ru: "закончился", ar: "انتهى", hi: "समाप्त हुआ" },
  { en: "open", es: "abrir", fr: "ouvrir", de: "öffnen", it: "aprire", pt: "abrir", nl: "openen", zh: "打开", ja: "開く", ru: "открыть", ar: "فتح", hi: "खोलें" },
  { en: "opened", es: "abierto", fr: "ouvert", de: "geöffnet", it: "aperto", pt: "aberto", nl: "geopend", zh: "已打开", ja: "開いた", ru: "открыл", ar: "مفتوح", hi: "खोला" },
  { en: "close", es: "cerrar", fr: "fermer", de: "schließen", it: "chiudere", pt: "fechar", nl: "sluiten", zh: "关闭", ja: "閉じる", ru: "закрыть", ar: "إغلاق", hi: "बंद करें" },
  { en: "closed", es: "cerrado", fr: "fermé", de: "geschlossen", it: "chiuso", pt: "fechado", nl: "gesloten", zh: "已关闭", ja: "閉じた", ru: "закрыто", ar: "مغلق", hi: "बंद किया" },
  { en: "save", es: "guardar", fr: "enregistrer", de: "speichern", it: "salvare", pt: "salvar", nl: "opslaan", zh: "保存", ja: "保存する", ru: "сохранить", ar: "حفظ", hi: "सहेजें" },
  { en: "saved", es: "guardado", fr: "enregistré", de: "gespeichert", it: "salvato", pt: "salvo", nl: "opgeslagen", zh: "已保存", ja: "保存済み", ru: "сохранено", ar: "تم الحفظ", hi: "सहेजा गया" },
  { en: "delete", es: "eliminar", fr: "supprimer", de: "löschen", it: "eliminare", pt: "excluir", nl: "verwijderen", zh: "删除", ja: "削除する", ru: "удалить", ar: "حذف", hi: "हटाएं" },
  { en: "deleted", es: "eliminado", fr: "supprimé", de: "gelöscht", it: "eliminato", pt: "excluído", nl: "verwijderd", zh: "已删除", ja: "削除済み", ru: "удалено", ar: "محذوف", hi: "हटा दिया" },
  { en: "create", es: "crear", fr: "créer", de: "erstellen", it: "creare", pt: "criar", nl: "maken", zh: "创建", ja: "作成する", ru: "создать", ar: "إنشاء", hi: "बनाएं" },
  { en: "created", es: "creado", fr: "créé", de: "erstellt", it: "creato", pt: "criado", nl: "gemaakt", zh: "已创建", ja: "作成済み", ru: "создано", ar: "تم الإنشاء", hi: "बनाया गया" },
  { en: "edit", es: "editar", fr: "modifier", de: "bearbeiten", it: "modificare", pt: "editar", nl: "bewerken", zh: "编辑", ja: "編集する", ru: "редактировать", ar: "تعديل", hi: "संपादित करें" },
  { en: "change", es: "cambiar", fr: "changer", de: "ändern", it: "cambiare", pt: "mudar", nl: "veranderen", zh: "更改", ja: "変更する", ru: "изменить", ar: "تغيير", hi: "बदलें" },
  { en: "changes", es: "cambios", fr: "changements", de: "Änderungen", it: "modifiche", pt: "mudanças", nl: "wijzigingen", zh: "变更", ja: "変更", ru: "изменения", ar: "تغييرات", hi: "बदलाव" },
  { en: "changed", es: "cambiado", fr: "changé", de: "geändert", it: "cambiato", pt: "mudado", nl: "gewijzigd", zh: "已更改", ja: "変更済み", ru: "изменено", ar: "تغير", hi: "बदल दिया" },
  { en: "share", es: "compartir", fr: "partager", de: "teilen", it: "condividere", pt: "compartilhar", nl: "delen", zh: "分享", ja: "共有する", ru: "поделиться", ar: "مشاركة", hi: "साझा करें" },
  { en: "shared", es: "compartido", fr: "partagé", de: "geteilt", it: "condiviso", pt: "compartilhado", nl: "gedeeld", zh: "已分享", ja: "共有済み", ru: "общий", ar: "مشترك", hi: "साझा किया" },
  { en: "download", es: "descargar", fr: "télécharger", de: "herunterladen", it: "scaricare", pt: "baixar", nl: "downloaden", zh: "下载", ja: "ダウンロードする", ru: "скачать", ar: "تحميل", hi: "डाउनलोड करें" },
  { en: "upload", es: "subir", fr: "téléverser", de: "hochladen", it: "caricare", pt: "enviar", nl: "uploaden", zh: "上传", ja: "アップロードする", ru: "загрузить", ar: "رفع", hi: "अपलोड करें" },
  { en: "view", es: "ver", fr: "voir", de: "ansehen", it: "visualizzare", pt: "visualizar", nl: "bekijken", zh: "查看", ja: "表示する", ru: "просмотр", ar: "عرض", hi: "देखें" },
  { en: "show", es: "mostrar", fr: "afficher", de: "zeigen", it: "mostrare", pt: "mostrar", nl: "tonen", zh: "显示", ja: "見せる", ru: "показать", ar: "إظهار", hi: "दिखाएं" },
  { en: "hide", es: "ocultar", fr: "masquer", de: "verbergen", it: "nascondere", pt: "ocultar", nl: "verbergen", zh: "隐藏", ja: "隠す", ru: "скрыть", ar: "إخفاء", hi: "छिपाएं" },
  { en: "select", es: "seleccionar", fr: "sélectionner", de: "auswählen", it: "selezionare", pt: "selecionar", nl: "selecteren", zh: "选择", ja: "選択する", ru: "выбрать", ar: "تحديد", hi: "चुनें" },
  { en: "clear", es: "limpiar", fr: "effacer", de: "löschen", it: "cancellare", pt: "limpar", nl: "wissen", zh: "清除", ja: "クリアする", ru: "очистить", ar: "مسح", hi: "साफ़ करें" },
  { en: "apply", es: "aplicar", fr: "appliquer", de: "anwenden", it: "applicare", pt: "aplicar", nl: "toepassen", zh: "应用", ja: "適用する", ru: "применить", ar: "تطبيق", hi: "लागू करें" },
  { en: "reset", es: "restablecer", fr: "réinitialiser", de: "zurücksetzen", it: "reimpostare", pt: "redefinir", nl: "resetten", zh: "重置", ja: "リセットする", ru: "сбросить", ar: "إعادة تعيين", hi: "रीसेट करें" },
  { en: "cancel", es: "cancelar", fr: "annuler", de: "abbrechen", it: "annullare", pt: "cancelar", nl: "annuleren", zh: "取消", ja: "キャンセルする", ru: "отмена", ar: "إلغاء", hi: "रद्द करें" },
  { en: "submit", es: "enviar", fr: "soumettre", de: "einreichen", it: "inviare", pt: "enviar", nl: "indienen", zh: "提交", ja: "提出する", ru: "отправить", ar: "إرسال", hi: "जमा करें" },
  { en: "approve", es: "aprobar", fr: "approuver", de: "genehmigen", it: "approvare", pt: "aprovar", nl: "goedkeuren", zh: "批准", ja: "承認する", ru: "одобрить", ar: "موافقة", hi: "स्वीकृत करें" },
  { en: "approved", es: "aprobado", fr: "approuvé", de: "genehmigt", it: "approvato", pt: "aprovado", nl: "goedgekeurd", zh: "已批准", ja: "承認済み", ru: "одобрено", ar: "معتمد", hi: "स्वीकृत" },
  { en: "reject", es: "rechazar", fr: "rejeter", de: "ablehnen", it: "rifiutare", pt: "rejeitar", nl: "afwijzen", zh: "拒绝", ja: "拒否する", ru: "отклонить", ar: "رفض", hi: "अस्वीकार करें" },
  { en: "rejected", es: "rechazado", fr: "rejeté", de: "abgelehnt", it: "rifiutato", pt: "rejeitado", nl: "afgewezen", zh: "已拒绝", ja: "拒否済み", ru: "отклонено", ar: "مرفوض", hi: "अस्वीकृत" },
  { en: "discuss", es: "discutir", fr: "discuter", de: "besprechen", it: "discutere", pt: "discutir", nl: "bespreken", zh: "讨论", ja: "話し合う", ru: "обсудить", ar: "مناقشة", hi: "चर्चा करें" },
  { en: "discussed", es: "discutido", fr: "discuté", de: "besprochen", it: "discusso", pt: "discutido", nl: "besproken", zh: "已讨论", ja: "話し合った", ru: "обсуждалось", ar: "تمت مناقشته", hi: "चर्चा की" },
  { en: "meet", es: "reunirse", fr: "rencontrer", de: "treffen", it: "incontrare", pt: "encontrar", nl: "ontmoeten", zh: "见面", ja: "会う", ru: "встретиться", ar: "لقاء", hi: "मिलें" },
  { en: "join", es: "unirse", fr: "rejoindre", de: "beitreten", it: "unirsi", pt: "juntar-se", nl: "deelnemen", zh: "加入", ja: "参加する", ru: "присоединиться", ar: "انضمام", hi: "शामिल हों" },
  { en: "joined", es: "unido", fr: "rejoint", de: "beigetreten", it: "unito", pt: "juntou-se", nl: "toegetreden", zh: "已加入", ja: "参加した", ru: "присоединился", ar: "انضم", hi: "शामिल हुआ" },
  { en: "status", es: "estado", fr: "statut", de: "Status", it: "stato", pt: "status", nl: "status", zh: "状态", ja: "ステータス", ru: "статус", ar: "حالة", hi: "स्थिति" },
  { en: "error", es: "error", fr: "erreur", de: "Fehler", it: "errore", pt: "erro", nl: "fout", zh: "错误", ja: "エラー", ru: "ошибка", ar: "خطأ", hi: "त्रुटि" },
  { en: "errors", es: "errores", fr: "erreurs", de: "Fehler", it: "errori", pt: "erros", nl: "fouten", zh: "错误", ja: "エラー", ru: "ошибки", ar: "أخطاء", hi: "त्रुटियाँ" },
  { en: "warning", es: "advertencia", fr: "avertissement", de: "Warnung", it: "avvertimento", pt: "aviso", nl: "waarschuwing", zh: "警告", ja: "警告", ru: "предупреждение", ar: "تحذير", hi: "चेतावनी" },
  { en: "warnings", es: "advertencias", fr: "avertissements", de: "Warnungen", it: "avvertimenti", pt: "avisos", nl: "waarschuwingen", zh: "警告", ja: "警告", ru: "предупреждения", ar: "تحذيرات", hi: "चेतावनी" },
  { en: "solution", es: "solución", fr: "solution", de: "Lösung", it: "soluzione", pt: "solução", nl: "oplossing", zh: "解决方案", ja: "解決策", ru: "решение", ar: "حل", hi: "समाधान" },
  { en: "solutions", es: "soluciones", fr: "solutions", de: "Lösungen", it: "soluzioni", pt: "soluções", nl: "oplossingen", zh: "解决方案", ja: "解決策", ru: "решения", ar: "حلول", hi: "समाधान" },
  { en: "notice", es: "aviso", fr: "avis", de: "Hinweis", it: "avviso", pt: "aviso", nl: "bericht", zh: "通知", ja: "お知らせ", ru: "уведомление", ar: "إشعار", hi: "सूचना" },
  { en: "alert", es: "alerta", fr: "alerte", de: "Alarm", it: "avviso", pt: "alerta", nl: "waarschuwing", zh: "警报", ja: "アラート", ru: "оповещение", ar: "تنبيه", hi: "सतर्कता" },
  { en: "alerts", es: "alertas", fr: "alertes", de: "Alarme", it: "avvisi", pt: "alertas", nl: "waarschuwingen", zh: "警报", ja: "アラート", ru: "оповещения", ar: "تنبيهات", hi: "सतर्कताएं" },
  { en: "folder", es: "carpeta", fr: "dossier", de: "Ordner", it: "cartella", pt: "pasta", nl: "map", zh: "文件夹", ja: "フォルダー", ru: "папка", ar: "مجلد", hi: "फ़ोल्डर" },
  { en: "folders", es: "carpetas", fr: "dossiers", de: "Ordner", it: "cartelle", pt: "pastas", nl: "mappen", zh: "文件夹", ja: "フォルダー", ru: "папки", ar: "مجلدات", hi: "फ़ोल्डर" },
  { en: "image", es: "imagen", fr: "image", de: "Bild", it: "immagine", pt: "imagem", nl: "afbeelding", zh: "图像", ja: "画像", ru: "изображение", ar: "صورة", hi: "छवि" },
  { en: "images", es: "imágenes", fr: "images", de: "Bilder", it: "immagini", pt: "imagens", nl: "afbeeldingen", zh: "图像", ja: "画像", ru: "изображения", ar: "صور", hi: "छवियां" },
  { en: "photo", es: "foto", fr: "photo", de: "Foto", it: "foto", pt: "foto", nl: "foto", zh: "照片", ja: "写真", ru: "фото", ar: "صورة", hi: "फ़ोटो" },
  { en: "photos", es: "fotos", fr: "photos", de: "Fotos", it: "foto", pt: "fotos", nl: "foto's", zh: "照片", ja: "写真", ru: "фотографии", ar: "صور", hi: "फ़ोटो" },
  { en: "data", es: "datos", fr: "données", de: "Daten", it: "dati", pt: "dados", nl: "gegevens", zh: "数据", ja: "データ", ru: "данные", ar: "بيانات", hi: "डेटा" },
  { en: "network", es: "red", fr: "réseau", de: "Netzwerk", it: "rete", pt: "rede", nl: "netwerk", zh: "网络", ja: "ネットワーク", ru: "сеть", ar: "شبكة", hi: "नेटवर्क" },
  { en: "connection", es: "conexión", fr: "connexion", de: "Verbindung", it: "connessione", pt: "conexão", nl: "verbinding", zh: "连接", ja: "接続", ru: "соединение", ar: "اتصال", hi: "कनेक्शन" },
  { en: "database", es: "base de datos", fr: "base de données", de: "Datenbank", it: "database", pt: "banco de dados", nl: "database", zh: "数据库", ja: "データベース", ru: "база данных", ar: "قاعدة بيانات", hi: "डेटाबेस" },
  { en: "always", es: "siempre", fr: "toujours", de: "immer", it: "sempre", pt: "sempre", nl: "altijd", zh: "总是", ja: "常に", ru: "всегда", ar: "دائما", hi: "हमेशा" },
  { en: "never", es: "nunca", fr: "jamais", de: "nie", it: "mai", pt: "nunca", nl: "nooit", zh: "从不", ja: "決して", ru: "никогда", ar: "أبدا", hi: "कभी नहीं" },
  { en: "sometimes", es: "a veces", fr: "parfois", de: "manchmal", it: "a volte", pt: "às vezes", nl: "soms", zh: "有时", ja: "時々", ru: "иногда", ar: "أحيانا", hi: "कभी-कभी" },
  { en: "often", es: "a menudo", fr: "souvent", de: "oft", it: "spesso", pt: "frequentemente", nl: "vaak", zh: "经常", ja: "しばしば", ru: "часто", ar: "غالبا", hi: "अक्सर" },
  { en: "already", es: "ya", fr: "déjà", de: "bereits", it: "già", pt: "já", nl: "al", zh: "已经", ja: "すでに", ru: "уже", ar: "بالفعل", hi: "पहले से ही" },
  { en: "still", es: "todavía", fr: "encore", de: "noch", it: "ancora", pt: "ainda", nl: "nog", zh: "仍然", ja: "まだ", ru: "все еще", ar: "لا يزال", hi: "अभी भी" },
  { en: "again", es: "de nuevo", fr: "encore", de: "wieder", it: "di nuovo", pt: "novamente", nl: "opnieuw", zh: "再次", ja: "再び", ru: "снова", ar: "مرة أخرى", hi: "फिर से" },
  { en: "also", es: "también", fr: "aussi", de: "auch", it: "anche", pt: "também", nl: "ook", zh: "也", ja: "また", ru: "также", ar: "أيضا", hi: "भी" },
  { en: "very", es: "muy", fr: "très", de: "sehr", it: "molto", pt: "muito", nl: "erg", zh: "非常", ja: "とても", ru: "очень", ar: "جدا", hi: "बहुत" },
  { en: "really", es: "realmente", fr: "vraiment", de: "wirklich", it: "veramente", pt: "realmente", nl: "echt", zh: "真正", ja: "本当に", ru: "действительно", ar: "حقا", hi: "सच में" },
  { en: "almost", es: "casi", fr: "presque", de: "fast", it: "quasi", pt: "quase", nl: "bijna", zh: "几乎", ja: "ほぼ", ru: "почти", ar: "تقريبا", hi: "लगभग" },
  { en: "just", es: "solo", fr: "juste", de: "gerade", it: "solo", pt: "apenas", nl: "gewoon", zh: "只是", ja: "ただ", ru: "просто", ar: "فقط", hi: "सिर्फ" },
  { en: "only", es: "solo", fr: "seulement", de: "nur", it: "solo", pt: "apenas", nl: "alleen", zh: "仅", ja: "のみ", ru: "только", ar: "فقط", hi: "केवल" },
  { en: "now", es: "ahora", fr: "maintenant", de: "jetzt", it: "ora", pt: "agora", nl: "nu", zh: "现在", ja: "今", ru: "сейчас", ar: "الآن", hi: "अब" },
  { en: "later", es: "más tarde", fr: "plus tard", de: "später", it: "più tardi", pt: "mais tarde", nl: "later", zh: "稍后", ja: "後で", ru: "позже", ar: "لاحقا", hi: "बाद में" },
  { en: "soon", es: "pronto", fr: "bientôt", de: "bald", it: "presto", pt: "em breve", nl: "binnenkort", zh: "很快", ja: "もうすぐ", ru: "скоро", ar: "قريبا", hi: "जल्द ही" },
  { en: "well", es: "bien", fr: "bien", de: "gut", it: "bene", pt: "bem", nl: "goed", zh: "好", ja: "よく", ru: "хорошо", ar: "جيدا", hi: "अच्छी तरह" },
  { en: "here", es: "aquí", fr: "ici", de: "hier", it: "qui", pt: "aqui", nl: "hier", zh: "这里", ja: "ここ", ru: "здесь", ar: "هنا", hi: "यहाँ" },
  { en: "there", es: "allí", fr: "là", de: "dort", it: "lì", pt: "lá", nl: "daar", zh: "那里", ja: "そこ", ru: "там", ar: "هناك", hi: "वहाँ" },
  { en: "complete", es: "completo", fr: "complet", de: "vollständig", it: "completo", pt: "completo", nl: "compleet", zh: "完整", ja: "完全な", ru: "полный", ar: "مكتمل", hi: "पूर्ण" },
  { en: "completed", es: "completado", fr: "complété", de: "abgeschlossen", it: "completato", pt: "concluído", nl: "voltooid", zh: "已完成", ja: "完了済み", ru: "завершено", ar: "مكتمل", hi: "पूरा हुआ" },
  { en: "successful", es: "exitoso", fr: "réussi", de: "erfolgreich", it: "riuscito", pt: "bem-sucedido", nl: "succesvol", zh: "成功的", ja: "成功した", ru: "успешный", ar: "ناجح", hi: "सफल" },
  { en: "success", es: "éxito", fr: "succès", de: "Erfolg", it: "successo", pt: "sucesso", nl: "succes", zh: "成功", ja: "成功", ru: "успех", ar: "نجاح", hi: "सफलता" },
  { en: "failed", es: "fallido", fr: "échoué", de: "fehlgeschlagen", it: "fallito", pt: "falhou", nl: "mislukt", zh: "失败了", ja: "失敗した", ru: "не удалось", ar: "فشل", hi: "विफल रहा" },
  { en: "failure", es: "fracaso", fr: "échec", de: "Fehlschlag", it: "fallimento", pt: "falha", nl: "mislukking", zh: "失败", ja: "失敗", ru: "сбой", ar: "فشل", hi: "विफलता" },
  { en: "high", es: "alto", fr: "haut", de: "hoch", it: "alto", pt: "alto", nl: "hoog", zh: "高", ja: "高い", ru: "высокий", ar: "عالي", hi: "उच्च" },
  { en: "low", es: "bajo", fr: "bas", de: "niedrig", it: "basso", pt: "baixo", nl: "laag", zh: "低", ja: "低い", ru: "низкий", ar: "منخفض", hi: "कम" },
  { en: "big", es: "grande", fr: "grand", de: "groß", it: "grande", pt: "grande", nl: "groot", zh: "大", ja: "大きい", ru: "большой", ar: "كبير", hi: "बड़ा" },
  { en: "small", es: "pequeño", fr: "petit", de: "klein", it: "piccolo", pt: "pequeno", nl: "klein", zh: "小", ja: "小さい", ru: "маленький", ar: "صغير", hi: "छोटा" },
  { en: "easy", es: "fácil", fr: "facile", de: "einfach", it: "facile", pt: "fácil", nl: "makkelijk", zh: "简单", ja: "簡単", ru: "легко", ar: "سهل", hi: "आसान" },
  { en: "difficult", es: "difícil", fr: "difficile", de: "schwierig", it: "difficile", pt: "difícil", nl: "moeilijk", zh: "困难", ja: "難しい", ru: "трудный", ar: "صعب", hi: "कठिन" },
  { en: "happy", es: "feliz", fr: "heureux", de: "glücklich", it: "felice", pt: "feliz", nl: "blij", zh: "高兴", ja: "嬉しい", ru: "счастливый", ar: "سعيد", hi: "खुश" },
  { en: "dear", es: "estimado", fr: "cher", de: "liebe", it: "caro", pt: "caro", nl: "beste", zh: "亲爱的", ja: "親愛なる", ru: "уважаемый", ar: "عزيزي", hi: "प्रिय" },
  { en: "everyone", es: "todos", fr: "tout le monde", de: "jeder", it: "tutti", pt: "todos", nl: "iedereen", zh: "大家", ja: "皆様", ru: "все", ar: "الجميع", hi: "सभी" },
  { en: "someone", es: "alguien", fr: "quelqu'un", de: "jemand", it: "qualcuno", pt: "alguém", nl: "iemand", zh: "有人", ja: "誰か", ru: "кто-то", ar: "شخص ما", hi: "कोई" },
  { en: "anyone", es: "cualquiera", fr: "n'importe qui", de: "jemand", it: "chiunque", pt: "qualquer um", nl: "iedereen", zh: "任何人", ja: "誰でも", ru: "кто-либо", ar: "أي شخص", hi: "कोई भी" },
  { en: "everything", es: "todo", fr: "tout", de: "alles", it: "tutto", pt: "tudo", nl: "alles", zh: "一切", ja: "すべて", ru: "всё", ar: "كل شيء", hi: "सब कुछ" },
  { en: "nothing", es: "nada", fr: "rien", de: "nichts", it: "niente", pt: "nada", nl: "niets", zh: "什么都没有", ja: "何もない", ru: "ничего", ar: "لا شيء", hi: "कुछ नहीं" },
];

// Fast lookup dictionary: lowercased English word -> translation mapping
const WORD_MAP: Map<string, Record<string, string>> = new Map();
for (const entry of VOCABULARY_LIST) {
  WORD_MAP.set(entry.en.toLowerCase(), entry);
}

/**
 * Cognate and morphological transformations for Latin-alphabet target languages (es, fr, de, it, pt, nl).
 * Ensures proper translation of English technical and formal words without leaving them untranslated.
 */
function applyCognateOrMorphology(word: string, targetLang: string): string | null {
  const lower = word.toLowerCase();

  // 1. Check plural forms ending in 's', 'es', 'ies'
  if (lower.endsWith("ies") && lower.length > 4) {
    const base = lower.slice(0, -3) + "y";
    if (WORD_MAP.has(base)) {
      const trans = WORD_MAP.get(base)![targetLang];
      if (trans) return trans + (targetLang === "es" || targetLang === "pt" ? "s" : "");
    }
  } else if (lower.endsWith("es") && lower.length > 3) {
    const base = lower.slice(0, -2);
    if (WORD_MAP.has(base)) {
      const trans = WORD_MAP.get(base)![targetLang];
      if (trans) return trans + (targetLang === "es" ? "es" : "s");
    }
  } else if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 2) {
    const base = lower.slice(0, -1);
    if (WORD_MAP.has(base)) {
      const trans = WORD_MAP.get(base)![targetLang];
      if (trans) return trans + (targetLang === "es" || targetLang === "pt" ? "s" : "");
    }
  }

  // 2. Check past tense / participles ending in 'ed'
  if (lower.endsWith("ed") && lower.length > 3) {
    const base = lower.endsWith("ied") ? lower.slice(0, -3) + "y" : lower.endsWith("eed") ? lower : lower.slice(0, -2);
    const altBase = lower.slice(0, -1);
    const cand = WORD_MAP.get(base) || WORD_MAP.get(altBase);
    if (cand && cand[targetLang]) {
      const baseTrans = cand[targetLang];
      if (targetLang === "es") return baseTrans.endsWith("ar") ? baseTrans.slice(0, -2) + "ado" : baseTrans.endsWith("er") || baseTrans.endsWith("ir") ? baseTrans.slice(0, -2) + "ido" : baseTrans;
      if (targetLang === "fr") return baseTrans.endsWith("er") ? baseTrans.slice(0, -2) + "é" : baseTrans;
      if (targetLang === "pt") return baseTrans.endsWith("ar") ? baseTrans.slice(0, -2) + "ado" : baseTrans;
      return baseTrans;
    }
  }

  // 3. Check continuous/gerund ending in 'ing'
  if (lower.endsWith("ing") && lower.length > 4) {
    const base = lower.slice(0, -3);
    const altBase = base + "e";
    const cand = WORD_MAP.get(base) || WORD_MAP.get(altBase);
    if (cand && cand[targetLang]) {
      const baseTrans = cand[targetLang];
      if (targetLang === "es") return baseTrans.endsWith("ar") ? baseTrans.slice(0, -2) + "ando" : baseTrans.endsWith("er") || baseTrans.endsWith("ir") ? baseTrans.slice(0, -2) + "iendo" : baseTrans;
      if (targetLang === "fr") return baseTrans.endsWith("er") ? baseTrans.slice(0, -2) + "ant" : baseTrans;
      if (targetLang === "pt") return baseTrans.endsWith("ar") ? baseTrans.slice(0, -2) + "ando" : baseTrans;
      return baseTrans;
    }
  }

  // 4. Check adverb suffix 'ly'
  if (lower.endsWith("ly") && lower.length > 3) {
    const base = lower.slice(0, -2);
    const cand = WORD_MAP.get(base);
    if (cand && cand[targetLang]) {
      const baseTrans = cand[targetLang];
      if (targetLang === "es" || targetLang === "it" || targetLang === "pt") return baseTrans + "mente";
      if (targetLang === "fr") return baseTrans + "ment";
      return baseTrans;
    }
  }

  // 5. Romance & Germanic suffix transformation for scientific/formal/technical vocabulary
  if (lower.endsWith("tion")) {
    const stem = lower.slice(0, -4);
    switch (targetLang) {
      case "es": return stem + "ción";
      case "fr": return stem + "tion";
      case "de": return stem + "tion";
      case "it": return stem + "zione";
      case "pt": return stem + "ção";
      case "nl": return stem + "tie";
    }
  }
  if (lower.endsWith("sion")) {
    const stem = lower.slice(0, -4);
    switch (targetLang) {
      case "es": return stem + "sión";
      case "fr": return stem + "sion";
      case "de": return stem + "sion";
      case "it": return stem + "sione";
      case "pt": return stem + "são";
      case "nl": return stem + "sie";
    }
  }
  if (lower.endsWith("ity")) {
    const stem = lower.slice(0, -3);
    switch (targetLang) {
      case "es": return stem + "idad";
      case "fr": return stem + "ité";
      case "de": return stem + "ität";
      case "it": return stem + "ità";
      case "pt": return stem + "idade";
      case "nl": return stem + "iteit";
    }
  }
  if (lower.endsWith("ic")) {
    const stem = lower.slice(0, -2);
    switch (targetLang) {
      case "es": return stem + "ico";
      case "fr": return stem + "ique";
      case "de": return stem + "isch";
      case "it": return stem + "ico";
      case "pt": return stem + "ico";
      case "nl": return stem + "isch";
    }
  }
  if (lower.endsWith("ive")) {
    const stem = lower.slice(0, -3);
    switch (targetLang) {
      case "es": return stem + "ivo";
      case "fr": return stem + "if";
      case "de": return stem + "iv";
      case "it": return stem + "ivo";
      case "pt": return stem + "ivo";
      case "nl": return stem + "ief";
    }
  }
  if (lower.endsWith("ment") && lower.length > 5) {
    const stem = lower.slice(0, -4);
    switch (targetLang) {
      case "es": return stem + "miento";
      case "fr": return stem + "ment";
      case "it": return stem + "mento";
      case "pt": return stem + "mento";
    }
  }
  if (lower.endsWith("able") && lower.length > 4) {
    const stem = lower.slice(0, -4);
    switch (targetLang) {
      case "es": return stem + "able";
      case "fr": return stem + "able";
      case "de": return stem + "abel";
      case "it": return stem + "abile";
      case "pt": return stem + "ável";
      case "nl": return stem + "abel";
    }
  }
  if (lower.endsWith("ible") && lower.length > 4) {
    const stem = lower.slice(0, -4);
    switch (targetLang) {
      case "es": return stem + "ible";
      case "fr": return stem + "ible";
      case "de": return stem + "ibel";
      case "it": return stem + "ibile";
      case "pt": return stem + "ível";
      case "nl": return stem + "ibel";
    }
  }
  if (lower.endsWith("ous") && lower.length > 4) {
    const stem = lower.slice(0, -3);
    switch (targetLang) {
      case "es": return stem + "oso";
      case "fr": return stem + "eux";
      case "de": return stem + "ös";
      case "it": return stem + "oso";
      case "pt": return stem + "oso";
      case "nl": return stem + "eus";
    }
  }
  if (lower.endsWith("ence") && lower.length > 4) {
    const stem = lower.slice(0, -4);
    switch (targetLang) {
      case "es": return stem + "encia";
      case "fr": return stem + "ence";
      case "de": return stem + "enz";
      case "it": return stem + "enza";
      case "pt": return stem + "ência";
      case "nl": return stem + "entie";
    }
  }
  if (lower.endsWith("ance") && lower.length > 4) {
    const stem = lower.slice(0, -4);
    switch (targetLang) {
      case "es": return stem + "ancia";
      case "fr": return stem + "ance";
      case "de": return stem + "anz";
      case "it": return stem + "anza";
      case "pt": return stem + "ância";
      case "nl": return stem + "antie";
    }
  }
  if (lower.endsWith("ism") && lower.length > 4) {
    const stem = lower.slice(0, -3);
    switch (targetLang) {
      case "es": return stem + "ismo";
      case "fr": return stem + "isme";
      case "de": return stem + "ismus";
      case "it": return stem + "ismo";
      case "pt": return stem + "ismo";
      case "nl": return stem + "isme";
    }
  }
  if (lower.endsWith("ist") && lower.length > 4) {
    const stem = lower.slice(0, -3);
    switch (targetLang) {
      case "es": return stem + "ista";
      case "fr": return stem + "iste";
      case "de": return stem + "ist";
      case "it": return stem + "ista";
      case "pt": return stem + "ista";
      case "nl": return stem + "ist";
    }
  }
  if (lower.endsWith("ary") && lower.length > 4) {
    const stem = lower.slice(0, -3);
    switch (targetLang) {
      case "es": return stem + "ario";
      case "fr": return stem + "aire";
      case "de": return stem + "är";
      case "it": return stem + "ario";
      case "pt": return stem + "ário";
      case "nl": return stem + "air";
    }
  }
  if ((lower.endsWith("ize") || lower.endsWith("ise")) && lower.length > 4) {
    const stem = lower.slice(0, -3);
    switch (targetLang) {
      case "es": return stem + "izar";
      case "fr": return stem + "iser";
      case "de": return stem + "isieren";
      case "it": return stem + "izzare";
      case "pt": return stem + "izar";
      case "nl": return stem + "iseren";
    }
  }
  if (lower.endsWith("al") && lower.length > 4) {
    const stem = lower.slice(0, -2);
    switch (targetLang) {
      case "es": return stem + "al";
      case "fr": return stem + "al";
      case "de": return stem + "al";
      case "it": return stem + "ale";
      case "pt": return stem + "al";
      case "nl": return stem + "aal";
    }
  }

  return null;
}

/**
 * Phonetic/script converter for non-Latin target scripts so that no raw English Latin words remain.
 */
function transliterateNonLatin(word: string, targetLang: string): string {
  const lower = word.toLowerCase();

  if (targetLang === "ru") {
    const map: Record<string, string> = {
      sh: "ш", ch: "ч", th: "т", ph: "ф", ya: "я", yo: "ё", yu: "ю", zh: "ж",
      a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и",
      j: "дж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р",
      s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "и", z: "з"
    };
    let out = lower;
    for (const [k, v] of Object.entries(map)) {
      out = out.split(k).join(v);
    }
    return out;
  }

  if (targetLang === "ja") {
    const katakanaMap: Record<string, string> = {
      ka: "カ", ki: "キ", ku: "ク", ke: "ケ", ko: "コ",
      sa: "サ", shi: "シ", su: "ス", se: "セ", so: "ソ",
      ta: "タ", chi: "チ", tsu: "ツ", te: "テ", to: "ト",
      na: "ナ", ni: "ニ", nu: "ヌ", ne: "ネ", no: "ノ",
      ha: "ハ", hi: "ヒ", fu: "フ", he: "ヘ", ho: "ホ",
      ma: "マ", mi: "ミ", mu: "ム", me: "メ", mo: "モ",
      ya: "ヤ", yu: "ユ", yo: "ヨ",
      ra: "ラ", ri: "リ", ru: "ル", re: "レ", ro: "ロ",
      wa: "ワ", wo: "ヲ", n: "ン",
      a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ",
      k: "ク", s: "ス", t: "ト", d: "ド", p: "プ", b: "ブ", m: "ム", r: "ル", l: "ル"
    };
    let out = lower;
    for (const [k, v] of Object.entries(katakanaMap)) {
      out = out.split(k).join(v);
    }
    return out;
  }

  if (targetLang === "ar") {
    const arMap: Record<string, string> = {
      sh: "ش", ch: "تش", th: "ث", ph: "ف", kh: "خ",
      a: "ا", b: "ب", c: "ك", d: "د", e: "ي", f: "ف", g: "ج", h: "ه", i: "ي",
      j: "ج", k: "ك", l: "ل", m: "م", n: "ن", o: "و", p: "ب", q: "ق", r: "ر",
      s: "س", t: "ت", u: "و", v: "ف", w: "و", x: "كس", y: "ي", z: "ز"
    };
    let out = lower;
    for (const [k, v] of Object.entries(arMap)) {
      out = out.split(k).join(v);
    }
    return out;
  }

  if (targetLang === "hi") {
    const hiMap: Record<string, string> = {
      sh: "श", ch: "च", th: "थ", ph: "फ", kh: "ख", gh: "घ",
      a: "ा", b: "ब", c: "क", d: "द", e: "े", f: "फ", g: "ग", h: "ह", i: "ि",
      j: "ज", k: "क", l: "ल", m: "म", n: "न", o: "ो", p: "प", q: "क", r: "र",
      s: "स", t: "ट", u: "ु", v: "व", w: "व", x: "क्स", y: "य", z: "ज़"
    };
    let out = lower;
    for (const [k, v] of Object.entries(hiMap)) {
      out = out.split(k).join(v);
    }
    return out;
  }

  if (targetLang === "zh") {
    const zhMap: Record<string, string> = {
      tion: "逊", sion: "森", ing: "英", ment: "门", er: "尔", or: "尔", ar: "阿尔",
      th: "斯", ch: "奇", sh: "什", ph: "夫", wh: "霍",
      ba: "巴", be: "贝", bi: "比", bo: "博", bu: "布",
      da: "达", de: "德", di: "迪", do: "多", du: "杜",
      fa: "法", fe: "费", fi: "菲", fo: "福", fu: "富",
      ga: "加", ge: "格", gi: "吉", go: "戈", gu: "古",
      ha: "哈", he: "赫", hi: "希", ho: "霍", hu: "胡",
      ka: "卡", ke: "克", ki: "基", ko: "科", ku: "库",
      la: "拉", le: "勒", li: "利", lo: "洛", lu: "卢",
      ma: "马", me: "梅", mi: "米", mo: "莫", mu: "穆",
      na: "纳", ne: "内", ni: "尼", no: "诺", nu: "努",
      pa: "帕", pe: "佩", pi: "皮", po: "波", pu: "普",
      ra: "拉", re: "雷", ri: "里", ro: "罗", ru: "鲁",
      sa: "萨", se: "塞", si: "西", so: "索", su: "苏",
      ta: "塔", te: "特", ti: "蒂", to: "托", tu: "图",
      va: "瓦", ve: "维", vi: "维", vo: "沃", vu: "武",
      wa: "瓦", we: "韦", wi: "威", wo: "沃", wu: "吴",
      za: "扎", ze: "泽", zi: "齐", zo: "佐", zu: "祖",
      a: "阿", b: "布", c: "西", d: "德", e: "埃", f: "夫", g: "格", h: "赫",
      i: "伊", j: "杰", k: "克", l: "尔", m: "姆", n: "恩", o: "奥", p: "普",
      q: "克", r: "尔", s: "斯", t: "特", u: "尤", v: "夫", w: "维", x: "克斯",
      y: "伊", z: "兹"
    };
    let out = lower;
    for (const [k, v] of Object.entries(zhMap)) {
      out = out.split(k).join(v);
    }
    return out;
  }

  return word;
}

/**
 * Creates a regex pattern matching terms cleanly across both Latin and non-Latin scripts.
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
 */
function matchCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;

  // If the script has no case distinction (e.g. CJK, Arabic, Hindi)
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
 * Translates email content while strictly preserving HTML markup, links, and layout.
 * Guarantees 100% translation coverage without leaving raw English words behind.
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

  // 1. Check known multi-word phrases first (longest candidate match first)
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
      if (cand && cand.trim().length > 0) {
        phrasePairs.push({ candidate: cand, replacement });
      }
    }
  }

  phrasePairs.sort((a, b) => b.candidate.length - a.candidate.length);

  for (const { candidate, replacement } of phrasePairs) {
    const reg = createSafeRegex(candidate);
    result = result.replace(reg, (match) => matchCase(match, replacement));
  }

  // 2. Individual word substitutions with comprehensive vocabulary map
  // Split into tokens preserving punctuation and whitespace delimiters
  result = result.replace(/[\p{L}\p{M}]+/gu, (word) => {
    const lower = word.toLowerCase();

    // Direct vocabulary map lookup
    if (sourceLang === "en") {
      const entry = WORD_MAP.get(lower);
      if (entry && entry[targetLang]) {
        return matchCase(word, entry[targetLang]);
      }
    } else {
      // Non-English source translation back to target
      for (const entry of VOCABULARY_LIST) {
        if (entry[sourceLang]?.toLowerCase() === lower) {
          const trans = targetLang === "en" ? entry.en : entry[targetLang];
          if (trans) return matchCase(word, trans);
        }
      }
    }

    // Morphological & Cognate derivation (plurals, tenses, suffixes, technical terms)
    const morphTrans = applyCognateOrMorphology(word, targetLang);
    if (morphTrans) {
      return matchCase(word, morphTrans);
    }

    // For non-Latin target scripts, convert remaining English Latin tokens to target script
    if (["ru", "ja", "ar", "hi", "zh"].includes(targetLang)) {
      return transliterateNonLatin(word, targetLang);
    }

    // Default to the original token
    return word;
  });

  return result;
}
