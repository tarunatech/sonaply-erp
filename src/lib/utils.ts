import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const COMMON_TRADE_MAP: Record<string, string> = {
  THE: "ધ",
  HONEST: "ઓનેસ્ટ",
  SALES: "સેલ્સ",
  SELECT: "સિલેક્ટ",
  LIMITLESS: "લિમિટલેસ",
  LUXURY: "લક્ઝરી",
  HARDWARE: "હાર્ડવેર",
  HARDWARES: "હાર્ડવેર્સ",
  ENTERPRISE: "એન્ટરપ્રાઈઝ",
  ENTERPRISES: "એન્ટરપ્રાઈઝીસ",
  TOUCH: "ટચ",
  PLY: "પ્લાય",
  PLYWOOD: "પ્લાયવુડ",
  WOOD: "વુડ",
  INTERIOR: "ઇન્ટિરિયર",
  INTERIORS: "ઇન્ટિરિયર્સ",
  ASSOCIATES: "એસોસિએટ્સ",
  TRADERS: "ટ્રેડર્સ",
  TRADER: "ટ્રેડર",
  TRADING: "ટ્રેડિંગ",
  TIMBER: "ટીમ્બર",
  DOOR: "ડોર",
  DOORS: "ડોર્સ",
  LAMINATE: "લેમિનેટ",
  LAMINATES: "લેમિનેટ્સ",
  FURNITURE: "ફર્નિચર",
  GLASS: "ગ્લાસ",
  KITCHEN: "કિચન",
  ALUMINIUM: "એલ્યુમિનિયમ",
  DECOR: "ડેકોર",
  DECORS: "ડેકોર્સ",
  WORLD: "વર્લ્ડ",
  HOUSE: "હાઉસ",
  HOME: "હોમ",
  CENTER: "સેન્ટર",
  CENTRE: "સેન્ટર",
  MART: "માર્ટ",
  STORE: "સ્ટોર",
  STORES: "સ્ટોર્સ",
  AGENCY: "એજન્સી",
  AGENCIES: "એજન્સીસ",
  COMPANY: "કંપની",
  CORP: "કોર્પ",
  CORPORATION: "કોર્પોરેશન",
  AND: "એન્ડ",
  "&": "&",
};

async function transliterateSingleWord(word: string): Promise<string> {
  const upper = word.toUpperCase();
  if (COMMON_TRADE_MAP[upper]) return COMMON_TRADE_MAP[upper];
  if (/^[\u0A80-\u0AFF]+$/.test(word)) return word;
  if (/^[^a-zA-Z0-9]+$/.test(word)) return word;

  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(word)}&itc=gu-t-i0-und&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8&app=test`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] === "SUCCESS" && Array.isArray(data[1]) && data[1].length > 0) {
        const cand = data[1][0];
        if (cand && Array.isArray(cand[1]) && cand[1].length > 0) {
          return cand[1][0];
        }
      }
    }
  } catch (err) {
    console.error("Google Input Tools single word error:", err);
  }
  return word;
}

export const transliterateToGujarati = async (text: string): Promise<string> => {
  if (!text || !text.trim()) return "";

  // If text already contains only Gujarati characters and standard punctuation, return as is
  if (/^[\u0A80-\u0AFF\s\(\)\-\,\.\/0-9\&\+]+$/.test(text.trim())) {
    return text.trim();
  }

  // Split into words, whitespace, and punctuation tokens while preserving delimiters
  const tokens = text.trim().split(/(\s+|\(|\)|\/|\-|\,|\&)/);
  const results: string[] = [];

  for (const token of tokens) {
    if (!token) continue;
    if (/^\s+$/.test(token) || /^[\(\)\/\-\,\&]+$/.test(token)) {
      results.push(token);
    } else {
      results.push(await transliterateSingleWord(token));
    }
  }

  return results
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
};
