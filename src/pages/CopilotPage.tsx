import React, { useEffect, useState } from 'react';
import { MessageSquareText, Send, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface Citation {
  type: string;
  code: string;
  label: string;
}

interface ChatTurn {
  id: string;
  query: string;
  answer: string;
  citations: Citation[];
  groundedRecordsCount?: number;
}

const SUGGESTED_QUESTIONS = [
  'Which materials have the highest dead-stock risk and what recovery strategy is best?',
  'What materials may create a stockout in the next 30 days?',
  'Which production orders could reuse our excess or dead stock fabric?',
  'How much inventory value is currently at risk vs realized recovery so far?',
];

export function CopilotPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{
      history: Array<{
        id: number;
        query_text: string;
        response_text: string;
        citations: Citation[];
      }>;
    }>('/api/copilot/history')
      .then((res) => {
        setTurns(
          res.history
            .slice()
            .reverse()
            .map((h) => ({
              id: String(h.id),
              query: h.query_text,
              answer: h.response_text,
              citations: h.citations,
            }))
        );
      })
      .catch(() => {});
  }, []);

  const submitQuestion = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        answer: string;
        citations: Citation[];
        groundedRecordsCount: number;
      }>('/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({ query: trimmed }),
      });
      setTurns((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          query: trimmed,
          answer: res.answer,
          citations: res.citations,
          groundedRecordsCount: res.groundedRecordsCount,
        },
      ]);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copilot query failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Grounding & Prompts Sidebar */}
      <div className="lg:col-span-4 space-y-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Database-Grounded RAG Copilot</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Every query retrieves verified inventory quantities, risk assessments, active BOMs, and
            recovery records scoped to your role before synthesizing an answer. The Copilot cannot
            modify stock or submit purchase orders without human approval.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2.5">
          <h2 className="font-display text-sm font-semibold">Suggested Queries</h2>
          <div className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={loading}
                onClick={() => submitQuestion(q)}
                className="w-full text-left p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-xs text-slate-700 dark:text-slate-200 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Chat Stream */}
      <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col min-h-[540px] max-h-[720px]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-slate-500" />
          <h2 className="font-display text-base font-semibold">Inventory Intelligence Thread</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {turns.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-2">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Ask a question about factory inventory, stockout exposure, or recovery options
              </div>
              <p className="text-xs text-slate-500 max-w-md">
                Responses cite exact material SKUs, warehouse codes, and production orders from the
                database.
              </p>
            </div>
          ) : (
            turns.map((t) => (
              <div key={t.id} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl px-4 py-2.5 bg-slate-900 dark:bg-blue-600 text-white text-sm">
                    {t.query}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {t.answer}
                  </div>
                  {t.citations.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 space-y-1">
                      <div className="font-semibold text-slate-600 dark:text-slate-400">
                        Verified Record References
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {t.citations.map((c, i) => (
                          <span key={`${c.code}-${i}`} className="font-mono">
                            {c.code} ({c.label})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              Querying verified inventory records and synthesizing grounded analysis...
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300"
            >
              {error}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitQuestion(input);
          }}
          className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about dead-stock SKUs, reorder dates, or compatible substitutes..."
            aria-label="Ask AI Inventory Copilot"
            className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ask Copilot</span>
          </button>
        </form>
      </div>
    </div>
  );
}
