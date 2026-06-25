"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
FaVolumeUp,
FaSearch,
FaMoon,
FaSun,
} from "react-icons/fa";

type Word = {
id: number;
english: string;
uzbek: string;
};

export default function Home() {
const [query, setQuery] = useState("");
const [words, setWords] = useState<Word[]>([]);
const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
const [selectedVoice, setSelectedVoice] = useState("");
const [theme, setTheme] = useState("dark");
const [loading, setLoading] = useState(false);

useEffect(() => {
const savedTheme =
localStorage.getItem("theme") || "dark";


setTheme(savedTheme);

const loadVoices = () => {
  const availableVoices =
    speechSynthesis.getVoices();

  setVoices(availableVoices);

  const savedVoice =
    localStorage.getItem("voice");

  if (savedVoice) {
    setSelectedVoice(savedVoice);
    return;
  }

  const preferredVoice =
    availableVoices.find((v) =>
      v.name
        .toLowerCase()
        .includes("google us english")
    ) ||
    availableVoices.find((v) =>
      v.name
        .toLowerCase()
        .includes("microsoft jenny")
    ) ||
    availableVoices.find(
      (v) => v.lang === "en-US"
    );

  if (preferredVoice) {
    setSelectedVoice(preferredVoice.name);
  }
};

loadVoices();

speechSynthesis.onvoiceschanged =
  loadVoices;


}, []);

useEffect(() => {
localStorage.setItem("theme", theme);
}, [theme]);

const searchWords = async (
value: string
) => {
setQuery(value);

if (!value.trim()) {
  setWords([]);
  return;
}

setLoading(true);

const { data, error } = await supabase
  .from("words")
  .select("*")
  .ilike(
    "english_lower",
    `${value.toLowerCase()}%`
  )
  .limit(20);

if (!error) {
  setWords(data || []);
}

setLoading(false);


};

const speak = (text: string) => {
speechSynthesis.cancel();


const utterance =
  new SpeechSynthesisUtterance(text);

const voice = voices.find(
  (v) => v.name === selectedVoice
);

if (voice) {
  utterance.voice = voice;
  utterance.lang = voice.lang;
}

utterance.rate = 0.9;
utterance.pitch = 1;

speechSynthesis.speak(utterance);


};

return (
<main
className={`min-h-screen flex items-center justify-center p-5 transition-all ${
        theme === "dark"
          ? "bg-zinc-950"
          : "bg-slate-100"
      }`}
>
<div
className={`w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden ${
          theme === "dark"
            ? "bg-zinc-900 border border-zinc-800"
            : "bg-white border border-slate-200"
        }`}
>
<div
className={`flex items-center justify-between px-6 py-5 border-b ${
            theme === "dark"
              ? "border-zinc-800"
              : "border-slate-200"
          }`}
> <div className="flex items-center gap-5">
<span
className={
theme === "dark"
? "text-zinc-300"
: "text-slate-700"
}
>
ENGLISH </span>
        <div className="text-xl">
          ⇄
        </div>

        <span
          className={
            theme === "dark"
              ? "text-zinc-300"
              : "text-slate-700"
          }
        >
          UZBEK
        </span>
      </div>

      <button
        onClick={() =>
          setTheme(
            theme === "dark"
              ? "light"
              : "dark"
          )
        }
        className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center"
      >
        {theme === "dark" ? (
          <FaSun className="text-white" />
        ) : (
          <FaMoon className="text-white" />
        )}
      </button>
    </div>

    <div className="p-6">
      <div className="relative">
        <FaSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />

        <input
          type="text"
          placeholder="Search word..."
          value={query}
          onChange={(e) =>
            searchWords(
              e.target.value
            )
          }
          className={`w-full rounded-2xl px-12 py-4 outline-none border text-lg ${
            theme === "dark"
              ? "bg-zinc-800 text-white border-zinc-700"
              : "bg-white text-black border-slate-300"
          }`}
        />
      </div>

      {query &&
        words.length > 0 && (
          <div
            className={`mt-2 rounded-xl overflow-hidden border ${
              theme === "dark"
                ? "bg-zinc-800 border-zinc-700"
                : "bg-white border-slate-300"
            }`}
          >
            {words
              .slice(0, 5)
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setQuery(
                      item.english
                    );
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-blue-500 hover:text-white transition"
                >
                  {item.english}
                </button>
              ))}
          </div>
        )}

      <div className="mt-4">
        <select
          value={selectedVoice}
          onChange={(e) => {
            setSelectedVoice(
              e.target.value
            );

            localStorage.setItem(
              "voice",
              e.target.value
            );
          }}
          className={`w-full rounded-xl px-4 py-3 border ${
            theme === "dark"
              ? "bg-zinc-800 text-white border-zinc-700"
              : "bg-white text-black border-slate-300"
          }`}
        >
          {voices
            .filter((voice) =>
              voice.lang.startsWith(
                "en"
              )
            )
            .map((voice) => (
              <option
                key={voice.name}
                value={voice.name}
              >
                {voice.name}
              </option>
            ))}
        </select>
      </div>

      {loading && (
        <div className="text-center py-10 text-blue-500">
          Searching...
        </div>
      )}

      <div className="mt-6 space-y-3">
        {words.map((word) => (
          <div
            key={word.id}
            className={`rounded-2xl p-4 border flex items-center justify-between ${
              theme === "dark"
                ? "bg-zinc-800 border-zinc-700"
                : "bg-slate-50 border-slate-200"
            }`}
          >
            <div>
              <h3
                className={`text-xl font-semibold ${
                  theme === "dark"
                    ? "text-white"
                    : "text-black"
                }`}
              >
                {word.english}
              </h3>

              <p
                className={
                  theme === "dark"
                    ? "text-zinc-400"
                    : "text-slate-500"
                }
              >
                {word.uzbek}
              </p>
            </div>

            <button
              onClick={() =>
                speak(
                  word.english
                )
              }
              className="h-12 w-12 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center"
            >
              <FaVolumeUp className="text-white" />
            </button>
          </div>
        ))}
      </div>

      {!query && (
        <div className="text-center py-20 text-zinc-500">
          Start typing...
        </div>
      )}

      {query &&
        words.length === 0 &&
        !loading && (
          <div className="text-center py-10 text-red-400">
            No words found
          </div>
        )}
    </div>
  </div>
</main>


);
}
