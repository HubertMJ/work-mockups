// The playground's canned answers. There is no model behind this page: a known prompt gets its
// written answer, anything else a short note saying so.

export const PRESETS: { prompt: string; answer: string }[] = [
  {
    prompt: 'Summarize this log line: "disk usage at 91% on /var, threshold 90%"',
    answer: "The /var partition is at 91% and has crossed its 90% alert threshold. Free some space there, or raise the threshold if the growth is expected.",
  },
  { prompt: "Write a haiku about GPUs", answer: "Ninety-six gigs hum,\nfour cards share the evening load,\nthe queue drains to none." },
  { prompt: 'Rewrite in plain English: "Utilize the aforementioned methodology."', answer: "Use the method mentioned above." },
  {
    prompt: "Explain a KV cache in two sentences",
    answer:
      "A KV cache keeps the attention keys and values of tokens the model has already read, so each new token only computes its own. It trades GPU memory for speed, which is why the context length decides how much memory a deployment needs.",
  },
];

const FALLBACK =
  "This answer is canned: the demo has no model behind it. A real deployment would stream its tokens through the gateway exactly like this, one server-sent event per token, after any cold start.";

export function answerFor(prompt: string): string {
  const p = prompt.trim();
  return PRESETS.find((x) => x.prompt === p)?.answer ?? FALLBACK;
}

/** Words with their trailing space, the way a tokenizer's pieces arrive closely enough for a demo. */
export const tokens = (text: string): string[] => text.match(/\S+\s*/g) ?? [];
