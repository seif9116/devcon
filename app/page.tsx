"use client";

import { useRouter } from "next/navigation";

const languages = [
  { code: "fr", name: "Français", flag: "🇫🇷" },
];

export default function Home() {
  const router = useRouter();

  function selectLanguage(code: string) {
    localStorage.setItem("security-flashcards-language", code);
    router.push("/modules");
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-4xl font-bold text-white mb-2">
          Security Guard Exam Prep
        </h1>
        <p className="text-blue-200 mb-8">
          Alberta Basic Security Training
        </p>
        <p className="text-white text-lg mb-6">Choose your language</p>
        <div className="space-y-3">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => selectLanguage(lang.code)}
              className="w-full bg-white text-blue-900 rounded-xl py-4 px-6 text-xl font-semibold hover:bg-blue-50 transition-colors flex items-center justify-center gap-3"
            >
              <span className="text-3xl">{lang.flag}</span>
              {lang.name}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
