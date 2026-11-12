import type { Settings } from '../../src/shared/types'
import { isRtlLanguage, languageLabel } from '../../src/shared/languages'

export interface DetectedLanguage {
  code: string
  label: string
  rtl: boolean
}

/**
 * Script detection first: it is unambiguous and needs no word list. Urdu and
 * Persian share the Arabic block, so they are matched by their own letters and
 * function words before the generic Arabic rule. Ukrainian is separated from
 * Russian by its distinct Cyrillic letters.
 */
const SCRIPT_LANGUAGES: { re: RegExp; code: string; label: string }[] = [
  { re: /[\u3040-\u30FF]/, code: 'ja', label: 'Japanese' },
  { re: /[\u4E00-\u9FFF]/, code: 'zh', label: 'Chinese (Simplified)' },
  { re: /[\uAC00-\uD7AF]/, code: 'ko', label: 'Korean' },
  { re: /[іїєґ]/i, code: 'uk', label: 'Ukrainian' },
  { re: /[\u0400-\u04FF]/, code: 'ru', label: 'Russian' },
  { re: /[\u0900-\u097F]/, code: 'hi', label: 'Hindi' },
  { re: /[\u0590-\u05FF]/, code: 'he', label: 'Hebrew' },
  { re: /[\u0E00-\u0E7F]/, code: 'th', label: 'Thai' },
  { re: /(?<!\p{L})(ہے|ہیں|کیا|آپ|نہیں|کیسے|کریں|مجھے|ہم|تم|کا|کی|کے)(?!\p{L})/u, code: 'ur', label: 'Urdu' },
  { re: /(است|چطور|چگونه|می‌خواه|میخواه|خوبی| ممنون|متشکرم|ایران|فارسی)/, code: 'fa', label: 'Persian' },
  { re: /(?<!\p{L})(بغيت|بغيتي|بغينا|شنو|كيفاش|دابا|ديال|واخا|بزاف|ماشي|زوين)(?!\p{L})/u, code: 'ary', label: 'Moroccan Darija' },
  { re: /[\u0600-\u06FF]/, code: 'ar', label: 'Arabic (Moroccan Darija if the user wrote Darija)' },
]

/**
 * Latin-script languages. Moroccan Darija (Arabizi) is first because it is the
 * most common here and its digraphs/numbers (3, 7, 9, 2, 5, 8) overlap no other
 * language. The rest follow by their function words.
 */
const LATIN_LANGUAGES: { re: RegExp; code: string; label: string }[] = [
  {
    re: /(?<![\p{L}\p{N}_])(sslm|slam|salam|bghit|bghiti|bghina|kanbghi|kifach|kifash|3afak|safi|mzyan|mzian|walo|daba|dba|wash|wach|chno|chnou|3lach|t9der|n9der|9der|9adra|khass|khsni|khassni|dyal|dial|makaynch|ma3rftch|bezzaf|bzzaf|chwiya|sahbi|khoya|zwina|zwin|labas|der|dir|dert|kayn|kayna|machi|b7al|walakin|walaynni|liya|lik|3ndi|3ndek|hna|tama|bslama|fhemtini|fhamtini|brit|bghit|wli|wlla|ila|ilaa|ghadi|radi|n3awd|ndir|ndiro|sayb|saybek|chkoun|7aja|7awj|chi|bjeh|Allah|inchallah|inshallah|yak|yakma|zid|zidt|khdem|khdam|kayn|makayn|smiti|smitek|fin|fina|3la|3liha|3lina|ma3a|m3a|bla|blak|wach|ach|achno|kidayer|kidaira|nhari|lyoum|lbare7|ghedda|d9i9a|sara7a|sr7|nkun|nkoun|n9der|t9der|nchofo|nchouf|chouf|chof|goul|gol|golia|9ol|9oli)(?![\p{L}\p{N}_])/giu,
    code: 'ary',
    label: 'Moroccan Darija (Arabic)',
  },
  { re: /(?<![\p{L}\p{N}_])(bonjour|salut|merci|comment|pourquoi|aujourd'hui|avec|dans|pour|vous|nous|c'est|j'ai|très|aussi|s'il|plaît|veux|peux|faire|être|ça|oui|non)(?![\p{L}\p{N}_])/giu, code: 'fr', label: 'French' },
  { re: /(?<![\p{L}\p{N}_])(hola|gracias|favor|cómo|como|qué|porque|también|donde|está|usted|necesito|quiero|puedes|hacer|por|para|pero|sí|buenos|días)(?![\p{L}\p{N}_])/giu, code: 'es', label: 'Spanish' },
  { re: /(?<![\p{L}\p{N}_])(hallo|danke|bitte|nicht|warum|auch|und|ist|das|ich|sie|kannst|wie|was|wer|wo|mit|für|sehr|gut|tag)(?![\p{L}\p{N}_])/giu, code: 'de', label: 'German' },
  { re: /(?<![\p{L}\p{N}_])(ciao|grazie|prego|come|perché|anche|sono|questo|quello|voglio|puoi|fare|per|con|non|si|buongiorno|oggi|domani)(?![\p{L}\p{N}_])/giu, code: 'it', label: 'Italian' },
  { re: /(?<![\p{L}\p{N}_])(merhaba|teşekkür|nasıl|niçin|lütfen|için|değil|bir|ve|bu|şu|ne|kim|nerede|yapmak|istiyorum|evet|hayır|günaydın)(?![\p{L}\p{N}_])/giu, code: 'tr', label: 'Turkish' },
  { re: /(?<![\p{L}\p{N}_])(obrigado|olá|você|não|para|porque|como|preciso|quero|pode|fazer|com|isso|este|sim|bom|dia|hoje)(?![\p{L}\p{N}_])/giu, code: 'pt', label: 'Portuguese' },
  { re: /(?<![\p{L}\p{N}_])(hallo|dank|wel|niet|waarom|ook|en|is|dat|ik|jij|kan|hoe|wat|wie|waar|met|voor|zeer|goed|dag|alstublieft)(?![\p{L}\p{N}_])/giu, code: 'nl', label: 'Dutch' },
  { re: /(?<![\p{L}\p{N}_])(cześć|dziękuję|proszę|jak|dlaczego|też|jest|to|ja|ty|możesz|zrobić|dla|nie|tak|dobry|dzień|dzisiaj)(?![\p{L}\p{N}_])/giu, code: 'pl', label: 'Polish' },
  { re: /(?<![\p{L}\p{N}_])(hej|tack|snälla|hur|varför|också|är|detta|jag|du|kan|göra|för|med|inte|ja|bra|dag|idag)(?![\p{L}\p{N}_])/giu, code: 'sv', label: 'Swedish' },
  { re: /(?<![\p{L}\p{N}_])(halo|terima|kasih|tolong|bagaimana|mengapa|juga|adalah|ini|saya|anda|bisa|untuk|dengan|tidak|ya|selamat|pagi|hari)(?![\p{L}\p{N}_])/giu, code: 'id', label: 'Indonesian' },
  { re: /(?<![\p{L}\p{N}_])(chào|cảm|ơn|làm|ơn|tại|sao|cũng|là|này|tôi|bạn|có|thể|để|với|không|vâng|ngày|hôm|nay)(?![\p{L}\p{N}_])/giu, code: 'vi', label: 'Vietnamese' },
]

/** Detects the language of a user message. Returns null when it cannot tell. */
export function detectLanguage(text: string): DetectedLanguage | null {
  const value = (text || '').trim()
  if (!value) return null
  for (const rule of SCRIPT_LANGUAGES) {
    if (rule.re.test(value)) return { code: rule.code, label: rule.label, rtl: isRtlLanguage(rule.code) }
  }
  const ambiguous = new Set(['to', 'is', 'was', 'tag', 'come', 'per', 'con', 'non', 'si', 'en', 'comment', 'der', 'dir', 'fin', 'wel', 'met', 'die', 'smiti'])
  let best: (typeof LATIN_LANGUAGES)[number] | undefined
  let bestScore = 0
  for (const rule of LATIN_LANGUAGES) {
    const words = [...value.matchAll(rule.re)].map((match) => match[0].toLowerCase())
    const score = words.filter((word) => !ambiguous.has(word)).length
    if (score > bestScore) { best = rule; bestScore = score }
  }
  return best ? { code: best.code, label: best.label, rtl: isRtlLanguage(best.code) } : null
}

/**
 * Short instruction appended to the user turn. Small local models follow a
 * directive next to the request far more reliably than a rule buried in a long
 * system prompt.
 */
export function languageDirective(settings: Pick<Settings, 'replyLanguage'>, prompt: string): string {
  const detected = detectLanguage(prompt)
  const forcedId = settings.replyLanguage && settings.replyLanguage !== 'auto' ? settings.replyLanguage : ''
  const forced = forcedId ? (forcedId === 'ary' ? 'Moroccan Darija (Arabic)' : languageLabel(forcedId)) : ''
  const label = forced || detected?.label || ''
  if (!label) return ''
  const rtl = forced ? isRtlLanguage(forcedId) : !!detected?.rtl
  const parts = [`[Language: answer in ${label}.`]
  if (forcedId === 'ary' || (!forced && detected?.code === 'ary')) {
    parts.push('Use the same script the user wrote in (Latin/Arabizi or Arabic script); Darija, Arabic and Arabizi express the same meaning.')
  }
  if (rtl) parts.push('For any interface you generate use dir="rtl" and logical CSS properties.')
  parts.push('Preserve code, identifiers, file names and commands exactly; never translate them. Do not switch the reply to English unless the user asks.]')
  return parts.join(' ')
}