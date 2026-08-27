import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const transliterateToGujarati = async (text: string): Promise<string> => {
  if (!text || !text.trim()) return "";

  // If text already contains Gujarati characters, return as is
  const hasGujaratiChars = /[\u0A80-\u0AFF]/.test(text);
  if (hasGujaratiChars) {
    return text.trim();
  }

  // 1. Primary: Google GTX Translate API
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=gu&dt=t&q=${encodeURIComponent(text.trim())}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translatedSegments = data[0]
          .map((seg: any) => (Array.isArray(seg) && seg[0] ? seg[0] : ""))
          .join("");
        if (translatedSegments && translatedSegments.trim()) {
          return translatedSegments.trim();
        }
      }
    }
  } catch (err) {
    console.error("Google GTX translation error:", err);
  }

  // 2. Fallback: Google Input Tools API
  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(text.trim())}&itc=gu-t-i10n&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8&app=test`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] === "SUCCESS" && Array.isArray(data[1])) {
        const translatedWords = data[1].map((wordGroup: any) => {
          if (wordGroup && Array.isArray(wordGroup[1]) && wordGroup[1].length > 0) {
            return wordGroup[1][0];
          }
          return wordGroup[0] || "";
        });
        const resultStr = translatedWords.join(" ").trim();
        if (resultStr) return resultStr;
      }
    }
  } catch (err) {
    console.error("Google Input Tools error:", err);
  }

  return text.trim();
};
