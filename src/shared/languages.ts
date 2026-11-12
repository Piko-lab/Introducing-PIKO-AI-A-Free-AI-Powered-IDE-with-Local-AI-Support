/**
 * Single source of truth for PIKO's reply languages. The Settings picker, the
 * backend language directive and the RTL chat layout all read from this list so
 * a language is never selectable in one place and missing in another.
 */
export interface LanguageDef {
  id: string
  label: string
  native: string
  rtl: boolean
}

export const LANGUAGES = [
  { id: 'auto', label: 'Auto (match my message)', native: 'Auto', rtl: false },
  { id: 'ary', label: 'Moroccan Darija', native: 'الدارجة المغربية', rtl: true },
  { id: 'ar', label: 'Arabic', native: 'العربية', rtl: true },
  { id: 'en', label: 'English', native: 'English', rtl: false },
  { id: 'fr', label: 'French', native: 'Français', rtl: false },
  { id: 'es', label: 'Spanish', native: 'Español', rtl: false },
  { id: 'de', label: 'German', native: 'Deutsch', rtl: false },
  { id: 'pt', label: 'Portuguese', native: 'Português', rtl: false },
  { id: 'it', label: 'Italian', native: 'Italiano', rtl: false },
  { id: 'nl', label: 'Dutch', native: 'Nederlands', rtl: false },
  { id: 'tr', label: 'Turkish', native: 'Türkçe', rtl: false },
  { id: 'ru', label: 'Russian', native: 'Русский', rtl: false },
  { id: 'uk', label: 'Ukrainian', native: 'Українська', rtl: false },
  { id: 'pl', label: 'Polish', native: 'Polski', rtl: false },
  { id: 'sv', label: 'Swedish', native: 'Svenska', rtl: false },
  { id: 'zh', label: 'Chinese (Simplified)', native: '中文', rtl: false },
  { id: 'ja', label: 'Japanese', native: '日本語', rtl: false },
  { id: 'ko', label: 'Korean', native: '한국어', rtl: false },
  { id: 'hi', label: 'Hindi', native: 'हिन्दी', rtl: false },
  { id: 'ur', label: 'Urdu', native: 'اردو', rtl: true },
  { id: 'fa', label: 'Persian', native: 'فارسی', rtl: true },
  { id: 'he', label: 'Hebrew', native: 'עברית', rtl: true },
  { id: 'id', label: 'Indonesian', native: 'Bahasa Indonesia', rtl: false },
  { id: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', rtl: false },
  { id: 'th', label: 'Thai', native: 'ไทย', rtl: false },
] as const satisfies readonly LanguageDef[]

export type ReplyLanguageId = (typeof LANGUAGES)[number]['id']

export const LANGUAGE_BY_ID: Record<string, LanguageDef> = Object.fromEntries(
  LANGUAGES.map((language) => [language.id, language]),
)

/** English label for a language id, or '' when unknown (e.g. 'auto'). */
export function languageLabel(id: string | undefined): string {
  if (!id || id === 'auto') return ''
  return LANGUAGE_BY_ID[id]?.label || ''
}

export function isRtlLanguage(id: string | undefined): boolean {
  return !!id && !!LANGUAGE_BY_ID[id]?.rtl
}

export const RTL_LANGUAGE_IDS: string[] = LANGUAGES.filter((language) => language.rtl).map((language) => language.id)

/** RTL scripts: Hebrew, Arabic, Syriac, Thaana, N'Ko, Arabic supplements and presentation forms. */
const RTL_SCRIPT = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/

/**
 * Direction for a piece of chat text, based on the script actually used. Darija
 * written in Arabic script is RTL; the same Darija in Arabizi (Latin) stays LTR.
 */
export function textDirection(text: string | undefined): 'rtl' | 'ltr' {
  const firstLetter = (text || '').match(/\p{L}/u)?.[0] || ''
  return RTL_SCRIPT.test(firstLetter) ? 'rtl' : 'ltr'
}