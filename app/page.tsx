"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FaVolumeUp, FaMicrophone, FaMoon, FaSun } from "react-icons/fa";

type Word = {
  id: number;
  english: string;
  uzbek: string;
};

// ---------------------------------------------------------------------------
// LOCAL GRAMMAR ENGINE
// Bu yerda hech qanday tashqi API ishlatilmaydi. Faqat Supabase "words"
// jadvalidagi lug'at + quyidagi qoidalar asosida gap tuzilmasi tiklanadi.
// 100% kafolat bermaydi (chunki bu to'liq NLP emas), lekin oddiy gaplar
// uchun yetarlicha to'g'ri natija beradi va butunlay bizning nazoratimizda.
// ---------------------------------------------------------------------------

// Function words that don't need dictionary lookup when translating EN -> UZ
const EN_TO_UZ_FUNCTION_WORDS: Record<string, string> = {
  is: "",
  are: "",
  am: "",
  the: "",
  a: "",
  an: "",
  this: "bu",
  that: "u",
  these: "bular",
  those: "ular",
};

// Possessive pronouns -> suffix rule applied to the noun that follows
const POSSESSIVE_SUFFIX: Record<string, { vowel: string; consonant: string }> = {
  my: { vowel: "m", consonant: "im" },
  your: { vowel: "ng", consonant: "ing" },
  his: { vowel: "si", consonant: "i" },
  her: { vowel: "si", consonant: "i" },
  its: { vowel: "si", consonant: "i" },
  our: { vowel: "miz", consonant: "imiz" },
  their: { vowel: "lari", consonant: "lari" },
};

const UZ_VOWELS = "aeiouoʻ";

function endsWithVowel(word: string) {
  const last = word.trim().slice(-1).toLowerCase();
  return UZ_VOWELS.includes(last);
}

function applyPossessiveSuffix(uzbekNoun: string, possessive: string) {
  const rule = POSSESSIVE_SUFFIX[possessive.toLowerCase()];
  if (!rule) return uzbekNoun;
  return uzbekNoun + (endsWithVowel(uzbekNoun) ? rule.vowel : rule.consonant);
}

// Reverse: strip a possessive suffix from a Uzbek word to recover the base
// (rough heuristic, used only for UZ -> EN direction)
const UZ_POSSESSIVE_SUFFIXES: { suffix: string; pronoun: string }[] = [
  { suffix: "imiz", pronoun: "our" },
  { suffix: "miz", pronoun: "our" },
  { suffix: "lari", pronoun: "their" },
  { suffix: "ing", pronoun: "your" },
  { suffix: "ng", pronoun: "your" },
  { suffix: "im", pronoun: "my" },
  { suffix: "m", pronoun: "my" },
  { suffix: "si", pronoun: "his/her" },
  { suffix: "i", pronoun: "his/her" },
];

function stripUzPossessive(word: string): { base: string; pronoun: string | null } {
  for (const { suffix, pronoun } of UZ_POSSESSIVE_SUFFIXES) {
    if (word.length > suffix.length + 1 && word.endsWith(suffix)) {
      return { base: word.slice(0, -suffix.length), pronoun };
    }
  }
  return { base: word, pronoun: null };
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [words, setWords] = useState<Word[]>([]);
  const [sentenceResult, setSentenceResult] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");
  const [theme, setTheme] = useState("dark");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [direction, setDirection] = useState<"en" | "uz">("en");

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") || "dark";
    setTheme(savedTheme);

    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      setVoices(availableVoices);

      const savedVoice = localStorage.getItem("voice");
      if (savedVoice) {
        setSelectedVoice(savedVoice);
        return;
      }

      const preferredVoice =
        availableVoices.find((v) =>
          v.name.toLowerCase().includes("google us english")
        ) ||
        availableVoices.find((v) =>
          v.name.toLowerCase().includes("microsoft jenny")
        ) ||
        availableVoices.find((v) => v.lang === "en-US");

      if (preferredVoice) {
        setSelectedVoice(preferredVoice.name);
      }
    };

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  // ---- Dictionary search (single word) ----
  const searchDictionary = async (value: string, dir: "en" | "uz") => {
    const column = dir === "en" ? "english_lower" : "uzbek_lower";

    const { data, error } = await supabase
      .from("words")
      .select("*")
      .ilike(column, `${value.toLowerCase()}%`)
      .limit(20);

    if (!error) {
      setWords(data || []);
    }
  };

  // ---- Look up every word of a sentence in one batch query ----
  const lookupWordsBatch = async (
    tokens: string[],
    dir: "en" | "uz"
  ): Promise<Record<string, string>> => {
    const column = dir === "en" ? "english_lower" : "uzbek_lower";
    const unique = Array.from(new Set(tokens.map((t) => t.toLowerCase())));

    const { data, error } = await supabase
      .from("words")
      .select("*")
      .in(column, unique);

    const map: Record<string, string> = {};
    if (!error && data) {
      for (const row of data as Word[]) {
        const key = dir === "en" ? row.english.toLowerCase() : row.uzbek.toLowerCase();
        map[key] = dir === "en" ? row.uzbek : row.english;
      }
    }
    return map;
  };

  // ---- English -> Uzbek sentence translation (local, rule-based) ----
  const translateEnToUz = async (sentence: string) => {
    const rawTokens = sentence.trim().split(/\s+/);
    const lookup = await lookupWordsBatch(rawTokens, "en");

    const result: string[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const tokenLower = rawTokens[i].toLowerCase().replace(/[.,!?]/g, "");

      // possessive pronoun -> attach suffix to next translated noun
      if (POSSESSIVE_SUFFIX[tokenLower] && i + 1 < rawTokens.length) {
        const nextLower = rawTokens[i + 1].toLowerCase().replace(/[.,!?]/g, "");
        const nounUz = lookup[nextLower];
        if (nounUz) {
          result.push(applyPossessiveSuffix(nounUz, tokenLower));
          i++; // consume the noun too
          continue;
        }
      }

      // function word (is/are/the/this/that...)
      if (tokenLower in EN_TO_UZ_FUNCTION_WORDS) {
        const replacement = EN_TO_UZ_FUNCTION_WORDS[tokenLower];
        if (replacement) result.push(replacement);
        continue;
      }

      // plain dictionary word
      if (lookup[tokenLower]) {
        result.push(lookup[tokenLower]);
        continue;
      }

      // not found - keep original word so user can see what's missing
      result.push(rawTokens[i]);
    }

    return result.filter(Boolean).join(" ");
  };

  // ---- Uzbek -> English sentence translation (local, rule-based) ----
  const translateUzToEn = async (sentence: string) => {
    const rawTokens = sentence.trim().split(/\s+/);

    // first pass: strip possessive suffixes to get base forms for lookup
    const baseForms = rawTokens.map((t) =>
      stripUzPossessive(t.toLowerCase().replace(/[.,!?]/g, ""))
    );

    const lookup = await lookupWordsBatch(
      baseForms.map((b) => b.base),
      "uz"
    );

    const result: string[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const tokenLower = rawTokens[i].toLowerCase().replace(/[.,!?]/g, "");
      const { base, pronoun } = baseForms[i];

      if (pronoun && lookup[base]) {
        if (pronoun === "his/her") {
          result.push("his/her", lookup[base]);
        } else {
          result.push(pronoun, lookup[base]);
        }
        continue;
      }

      if (lookup[tokenLower]) {
        result.push(lookup[tokenLower]);
        continue;
      }

      if (lookup[base]) {
        result.push(lookup[base]);
        continue;
      }

      result.push(rawTokens[i]);
    }

    return result.filter(Boolean).join(" ");
  };

  const searchWords = async (value: string, dir: "en" | "uz" = direction) => {
    setQuery(value);
    setSentenceResult(null);

    if (!value.trim()) {
      setWords([]);
      return;
    }

    setLoading(true);

    const isPhrase = value.trim().split(/\s+/).length > 1;

    if (isPhrase) {
      setWords([]);
      const translated =
        dir === "en"
          ? await translateEnToUz(value.trim())
          : await translateUzToEn(value.trim());
      setSentenceResult(translated);
    } else {
      await searchDictionary(value, dir);
    }

    setLoading(false);
  };

  const swapDirection = () => {
    const newDir = direction === "en" ? "uz" : "en";
    setDirection(newDir);
    setQuery("");
    setWords([]);
    setSentenceResult(null);
  };

  const speak = (text: string, lang: "en" | "uz") => {
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    if (lang === "en") {
      const voice = voices.find((v) => v.name === selectedVoice);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
    } else {
      utterance.lang = "uz-UZ";
    }

    utterance.rate = 0.9;
    utterance.pitch = 1;

    speechSynthesis.speak(utterance);
  };

  // ---- Voice search (microphone -> text) ----
  const startListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Bu brauzer ovozli qidiruvni qo'llab-quvvatlamaydi.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = direction === "en" ? "en-US" : "uz-UZ";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      searchWords(transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const isDark = theme === "dark";
  const leftLang = direction === "en" ? "English" : "Uzbek";
  const rightLang = direction === "en" ? "Uzbek" : "English";

  return (
    <main
      className={`min-h-screen flex items-start justify-center p-4 sm:p-8 transition-colors duration-300 ${
        isDark ? "bg-[#131314]" : "bg-white"
      }`}
    >
      <div className="w-full max-w-5xl">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 px-2">
          <h1
            className={`text-2xl font-medium ${
              isDark ? "text-zinc-200" : "text-[#1f1f1f]"
            }`}
          >
            <span className="text-blue-500">English</span>
            <span className={isDark ? "text-zinc-500" : "text-zinc-400"}>
              {" "}
              ⇄{" "}
            </span>
            <span style={{ color: "#16a766" }}>Uzbek</span>{" "}
            <span className={isDark ? "text-zinc-400" : "text-zinc-500"}>
              Lug'at
            </span>
          </h1>

          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label="Toggle theme"
            className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors ${
              isDark
                ? "bg-zinc-800 hover:bg-zinc-700 text-yellow-300"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700"
            }`}
          >
            {isDark ? <FaSun /> : <FaMoon />}
          </button>
        </div>

        {/* Translate-style card */}
        <div
          className={`rounded-3xl overflow-hidden border ${
            isDark
              ? "bg-[#1e1f20] border-zinc-800"
              : "bg-white border-slate-200 shadow-sm"
          }`}
        >
          {/* Language labels row - swap position with direction */}
          <div
            className={`flex items-center ${
              isDark ? "border-b border-zinc-800" : "border-b border-slate-200"
            }`}
          >
            <div className="flex-1 px-6 py-3">
              <span className="text-sm font-medium pb-1 border-b-2 border-blue-500 text-blue-500">
                {leftLang}
              </span>
            </div>

            <button
              onClick={swapDirection}
              aria-label="Swap languages"
              className={`mx-2 h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                isDark
                  ? "hover:bg-zinc-800 text-zinc-300"
                  : "hover:bg-slate-100 text-zinc-600"
              }`}
            >
              ⇄
            </button>

            <div className="flex-1 px-6 py-3 text-right">
              <span
                className={`text-sm font-medium ${
                  isDark ? "text-zinc-400" : "text-zinc-500"
                }`}
              >
                {rightLang}
              </span>
            </div>
          </div>

          {/* Input / results split, Google Translate style */}
          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Left: input (always matches leftLang) */}
            <div
              className={`p-6 min-h-[180px] flex flex-col ${
                isDark
                  ? "md:border-r border-zinc-800"
                  : "md:border-r border-slate-200"
              }`}
            >
              <input
                type="text"
                placeholder={
                  direction === "en"
                    ? "Type a word or phrase..."
                    : "So'z yoki gap kiriting..."
                }
                value={query}
                onChange={(e) => searchWords(e.target.value)}
                className={`w-full bg-transparent outline-none text-2xl flex-1 ${
                  isDark
                    ? "text-zinc-100 placeholder-zinc-500"
                    : "text-[#1f1f1f] placeholder-zinc-400"
                }`}
              />

              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={startListening}
                  aria-label="Voice search"
                  className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                    listening
                      ? "bg-red-500 text-white animate-pulse"
                      : isDark
                      ? "hover:bg-zinc-800 text-zinc-400"
                      : "hover:bg-slate-100 text-zinc-500"
                  }`}
                >
                  <FaMicrophone />
                </button>

                {query && (
                  <button
                    onClick={() =>
                      speak(query, direction === "en" ? "en" : "uz")
                    }
                    aria-label="Listen to input"
                    className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors ${
                      isDark
                        ? "hover:bg-zinc-800 text-zinc-400"
                        : "hover:bg-slate-100 text-zinc-500"
                    }`}
                  >
                    <FaVolumeUp />
                  </button>
                )}
              </div>
            </div>

            {/* Right: results (always matches rightLang) */}
            <div
              className={`p-6 min-h-[180px] ${
                isDark ? "bg-[#1a1b1c]" : "bg-[#f8f9fa]"
              }`}
            >
              {loading && (
                <div
                  className={`text-base ${
                    isDark ? "text-zinc-400" : "text-zinc-500"
                  }`}
                >
                  Qidirilmoqda...
                </div>
              )}

              {!loading && !query && (
                <div
                  className={`text-2xl ${
                    isDark ? "text-zinc-500" : "text-zinc-400"
                  }`}
                >
                  Tarjima
                </div>
              )}

              {/* Full sentence translation result */}
              {!loading && sentenceResult && (
                <div className="flex items-start justify-between gap-3">
                  <p
                    className={`text-2xl ${
                      isDark ? "text-zinc-100" : "text-[#1f1f1f]"
                    }`}
                  >
                    {sentenceResult}
                  </p>
                  <button
                    onClick={() =>
                      speak(sentenceResult, direction === "en" ? "uz" : "en")
                    }
                    aria-label="Listen"
                    className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                      isDark
                        ? "hover:bg-zinc-800 text-zinc-300"
                        : "hover:bg-slate-200 text-zinc-600"
                    }`}
                  >
                    <FaVolumeUp />
                  </button>
                </div>
              )}

              {/* Single word dictionary results */}
              {!loading && !sentenceResult && query && words.length === 0 && (
                <div className="text-base text-red-400">So'z topilmadi</div>
              )}

              {!loading && !sentenceResult && words.length > 0 && (
                <div className="space-y-4">
                  {words.map((word) => {
                    const primary =
                      direction === "en" ? word.uzbek : word.english;
                    const secondary =
                      direction === "en" ? word.english : word.uzbek;
                    const speakLang: "en" | "uz" =
                      direction === "en" ? "uz" : "en";

                    return (
                      <div
                        key={word.id}
                        className="flex items-start justify-between gap-3"
                      >
                        <div>
                          <p
                            className={`text-2xl ${
                              isDark ? "text-zinc-100" : "text-[#1f1f1f]"
                            }`}
                          >
                            {primary}
                          </p>
                          <p
                            className={`text-sm mt-1 ${
                              isDark ? "text-zinc-400" : "text-zinc-500"
                            }`}
                          >
                            {secondary}
                          </p>
                        </div>

                        <button
                          onClick={() => speak(primary, speakLang)}
                          aria-label="Listen"
                          className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                            isDark
                              ? "hover:bg-zinc-800 text-zinc-300"
                              : "hover:bg-slate-200 text-zinc-600"
                          }`}
                        >
                          <FaVolumeUp />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Voice selector */}
        <div className="mt-6 px-2">
          <label
            className={`block text-xs mb-1 ${
              isDark ? "text-zinc-500" : "text-zinc-500"
            }`}
          >
            Ovoz / Voice
          </label>
          <select
            value={selectedVoice}
            onChange={(e) => {
              setSelectedVoice(e.target.value);
              localStorage.setItem("voice", e.target.value);
            }}
            className={`w-full rounded-xl px-4 py-3 border text-sm ${
              isDark
                ? "bg-zinc-900 text-zinc-200 border-zinc-800"
                : "bg-white text-zinc-700 border-slate-200"
            }`}
          >
            {voices
              .filter((voice) => voice.lang.startsWith("en"))
              .map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
          </select>
        </div>
      </div>
    </main>
  );
}