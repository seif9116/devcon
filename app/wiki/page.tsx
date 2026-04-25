"use client";

import { useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });
import type { WikiData, WikiPage as WikiPageType } from "@/lib/types";
import wikiData from "@/public/wiki/pages.json";

const data = wikiData as WikiData;

const MODULE_NAMES: Record<number, string> = {
  1: "Introduction to the Security Industry",
  2: "The Canadian Legal System",
  3: "Basic Security Procedures",
  4: "Communication",
  5: "Documentation and Evidence",
  6: "Response Procedures",
  7: "Health and Safety",
};

function WikiBrowser() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialSlug = searchParams.get("page") || data.pages[0]?.slug || "";
  const [activeSlug, setActiveSlug] = useState(initialSlug);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const pagesByModule = useMemo(() => {
    const grouped: Record<number, WikiPageType[]> = {};
    for (const page of data.pages) {
      if (!grouped[page.moduleId]) grouped[page.moduleId] = [];
      grouped[page.moduleId].push(page);
    }
    return grouped;
  }, []);

  const activePage = data.pages.find((p) => p.slug === activeSlug) || data.pages[0];

  function selectPage(slug: string) {
    setActiveSlug(slug);
    setSidebarOpen(false);
    router.replace(`/wiki?page=${slug}`, { scroll: false });
  }

  if (data.pages.length === 0) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-2xl mb-2">📖</p>
          <p className="text-gray-500">Wiki pages are being generated. Check back soon!</p>
          <button
            onClick={() => router.push("/modules")}
            className="mt-4 text-blue-600 hover:text-blue-700 text-sm"
          >
            ← Back to Modules
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-3 p-4 bg-white border-b border-gray-200">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-gray-600 text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"
        >
          ☰
        </button>
        <h1 className="font-bold text-gray-900">Wiki</h1>
        <button
          onClick={() => router.push("/modules")}
          className="ml-auto text-blue-600 text-sm"
        >
          ← Modules
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "block" : "hidden"
        } md:block w-full md:w-72 bg-white border-r border-gray-200 md:min-h-screen overflow-y-auto flex-shrink-0`}
      >
        <div className="p-4 border-b border-gray-200 hidden md:flex items-center justify-between">
          <h1 className="font-bold text-gray-900">📖 Wiki</h1>
          <button
            onClick={() => router.push("/modules")}
            className="text-blue-600 text-sm hover:opacity-70"
          >
            ← Modules
          </button>
        </div>
        <nav className="p-2">
          {Object.entries(pagesByModule)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([modId, pages]) => (
              <div key={modId} className="mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 py-1">
                  M{modId}: {MODULE_NAMES[Number(modId)] || ""}
                </p>
                {pages.map((page) => (
                  <button
                    key={page.slug}
                    onClick={() => selectPage(page.slug)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      page.slug === activeSlug
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {page.title}
                  </button>
                ))}
              </div>
            ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-3xl">
          {activePage && (
            <>
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-700 mb-4 inline-block">
                Module {activePage.moduleId}
              </span>
              <article className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900">
                <ReactMarkdown>{activePage.body}</ReactMarkdown>
              </article>
              {activePage.relatedSlugs.length > 0 && (
                <div className="mt-8 pt-4 border-t border-gray-200">
                  <p className="text-sm font-medium text-gray-500 mb-2">Related Concepts</p>
                  <div className="flex flex-wrap gap-2">
                    {activePage.relatedSlugs.map((slug) => {
                      const related = data.pages.find((p) => p.slug === slug);
                      if (!related) return null;
                      return (
                        <button
                          key={slug}
                          onClick={() => selectPage(slug)}
                          className="text-sm px-3 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                        >
                          {related.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function WikiPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading wiki...</p>
      </main>
    }>
      <WikiBrowser />
    </Suspense>
  );
}
