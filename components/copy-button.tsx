"use client";

import { useState } from "react";

export default function CopyButton({ textToCopy }: { textToCopy: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-zinc-300 rounded border border-zinc-700 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1"
      aria-label="Copy to clipboard"
    >
      <span className="text-[10px] uppercase tracking-wider font-semibold">
        {copied ? "Copied!" : "Copy"}
      </span>
    </button>
  );
}
