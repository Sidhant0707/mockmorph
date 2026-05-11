"use client";

import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  HiPlay,
  HiArrowPath,
  HiCodeBracket,
  HiClipboardDocument,
  HiArrowDownTray,
  HiCheck,
  HiAdjustmentsHorizontal,
  HiBeaker,
  HiOutlineXMark,
  HiOutlineLockClosed,
  HiOutlineExclamationCircle
} from "react-icons/hi2";

// --- Types & Parsers ---
interface TerminalLine {
  id: string;
  type: "system" | "ai" | "edge" | "sql" | "complete" | "error" | "blank";
  content: string;
}

interface SemanticSchemaMap {
  topology: string[];
  tables: Record<string, Record<string, string>>;
}

let lineCounter = 0;

function parseTerminalLine(text: string, runId: number): TerminalLine {
  const id = `line-${runId}-${lineCounter++}`;
  const trimmed = text.trim();

  if (!trimmed) return { id, type: "blank", content: "" };
  if (trimmed.startsWith("-- [SYS]"))
    return {
      id,
      type: "system",
      content: trimmed.replace("-- [SYS]", "").trim(),
    };
  if (trimmed.startsWith("-- [AI]"))
    return { id, type: "ai", content: trimmed.replace("-- [AI]", "").trim() };
  if (trimmed.startsWith("-- [EDGE]"))
    return {
      id,
      type: "edge",
      content: trimmed.replace("-- [EDGE]", "").trim(),
    };
  if (trimmed.startsWith("-- [COMPLETE]"))
    return {
      id,
      type: "complete",
      content: trimmed.replace("-- [COMPLETE]", "").trim(),
    };
  if (trimmed.startsWith("-- [FATAL ERROR]"))
    return { id, type: "error", content: trimmed.replace("--", "").trim() };
  if (trimmed.startsWith("INSERT"))
    return { id, type: "sql", content: trimmed };

  return { id, type: "sql", content: trimmed };
}

export default function TerminalSection() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter(); 

  const defaultSchema = `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255),
  full_name TEXT
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  amount DECIMAL
);`;

  // --- Core State ---
  const [userSchemaCode, setUserSchemaCode] = useState(defaultSchema);
  const [fullSql, setFullSql] = useState<string>("");
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [status, setStatus] = useState<"idle" | "generating" | "complete">("idle");
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  // --- UI & Config State ---
  const [activeTab, setActiveTab] = useState<"schema" | "config">("schema");
  const [expectedRows, setExpectedRows] = useState(50);
  const [sqlDialect, setSqlDialect] = useState<"postgres" | "mysql">("postgres");

  // --- Schema Intelligence State ---
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [schemaMapping, setSchemaMapping] = useState<SemanticSchemaMap | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);

  // --- Modal States ---
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [errorModalMsg, setErrorModalMsg] = useState<string | null>(null);

  const semanticTypes = [
    "pk",
    "fk",
    "email",
    "fullname",
    "price",
    "product",
    "company",
    "phone",
    "date",
    "boolean",
    "string",
  ];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (status === "generating") {
      timer = setInterval(() => setElapsedTime((p) => p + 0.1), 100);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (authModalOpen || errorModalMsg) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [authModalOpen, errorModalMsg]);

  const handleAnalyzeSchema = async () => {
    setIsAnalyzing(true);
    setSchemaMapping(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawSchema: userSchemaCode }),
      });

      if (response.status === 401) {
        setAuthModalOpen(true);
        return;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            data?.error || "Rate limit exceeded. Please wait an hour before analyzing again."
          );
        }
        throw new Error(data?.error || `HTTP error! status: ${response.status}`);
      }

      setSchemaMapping({ topology: data.topology, tables: data.tables });
      if (data.remaining !== undefined) {
        setQuotaRemaining(data.remaining);
      }
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : "An unexpected error occurred.";
      setErrorModalMsg(msg);
      setActiveTab("schema");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleMappingChange = (
    tableName: string,
    columnName: string,
    newType: string,
  ) => {
    setSchemaMapping((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tables: {
          ...prev.tables,
          [tableName]: {
            ...prev.tables[tableName],
            [columnName]: newType,
          },
        },
      };
    });
  };

  const handleStartGeneration = useCallback(async () => {
    if (status === "generating") return;

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setStatus("generating");
    setLines([]);
    setFullSql("");
    setElapsedTime(0);
    setCopied(false);
    lineCounter = 0;
    const runId = Date.now();

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawSchema: userSchemaCode,
          config: { rowCount: expectedRows, dialect: sqlDialect },
          semanticMap: schemaMapping,
        }),
        signal: abortController.signal,
      });

      if (response.status === 401) {
        setStatus("idle");
        setAuthModalOpen(true);
        return;
      }

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      if (!response.body) throw new Error("No readable stream available.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const stringLines = buffer.split("\n");
        buffer = stringLines.pop() || "";

        const newLines: TerminalLine[] = [];
        let sqlBuffer = "";

        for (const line of stringLines) {
          const parsed = parseTerminalLine(line, runId);
          newLines.push(parsed);
          if (parsed.type === "sql") sqlBuffer += line + "\n";
        }

        if (newLines.length > 0) {
          setLines((prev) => [...prev, ...newLines]);
          if (sqlBuffer) setFullSql((prev) => prev + sqlBuffer);
        }
      }

      setStatus("complete");
      abortControllerRef.current = null;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatus("idle");
        return;
      }
      const msg = error instanceof Error ? error.message : "Connection error";
      setLines((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, type: "error", content: `FAIL: ${msg}` },
      ]);
      setStatus("complete");
      abortControllerRef.current = null;
    }
  }, [status, userSchemaCode, expectedRows, sqlDialect, schemaMapping]);

  const sqlLinesCount = useMemo(
    () => lines.filter((l) => l.type === "sql").length,
    [lines],
  );

  const progressPercentage = useMemo(() => {
    if (status === "idle") return 0;
    if (status === "complete") return 100;
    return Math.min(100, (sqlLinesCount / expectedRows) * 100);
  }, [status, sqlLinesCount, expectedRows]);

  const handleCopy = () => {
    if (!fullSql) return;
    navigator.clipboard.writeText(fullSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([fullSql], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mockmorph_export_${Date.now()}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Computed States for UX ---
  const isReadyToGenerate = !!schemaMapping && status === "idle";
  const isGenerating = status === "generating";
  const isComplete = status === "complete";

  return (
    <section id="terminal" className="relative z-10 py-32">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes scan { from { transform: translateY(-100%); } to { transform: translateY(100%); } }
        .crt-overlay { pointer-events: none; position: absolute; inset: 0; background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.15) 50%); background-size: 100% 4px; z-index: 10; }
        .crt-scanline { pointer-events: none; position: absolute; inset: 0; height: 20%; background: linear-gradient(to bottom, transparent, rgba(6, 182, 212, 0.1), transparent); animation: scan 6s linear infinite; z-index: 11; }
      `,
        }}
      />

      {/* --- PREMIUM NEUTRAL MODALS --- */}
      <AnimatePresence>
        {authModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-[#0f0f11] border border-white/10 rounded-2xl p-8 max-w-sm w-full shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              
              <button
                onClick={() => setAuthModalOpen(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
                title="Close dialog"
              >
                <HiOutlineXMark className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center text-center mt-2">
                <div className="w-14 h-14 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center mb-5 shadow-inner">
                  <HiOutlineLockClosed className="w-7 h-7 text-zinc-300" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2 tracking-tight">Access Locked</h3>
                <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
                  Sign in to authenticate your session and access the MockMorph synthesis engine.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full">
                  <button
                    onClick={() => setAuthModalOpen(false)}
                    className="flex-1 py-2.5 rounded-lg bg-transparent hover:bg-white/5 border border-white/10 text-zinc-300 text-sm font-semibold transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => router.push('/login')}
                    className="flex-1 py-2.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-sm font-bold shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-all"
                  >
                    Sign In
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {errorModalMsg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-[#0f0f11] border border-white/10 rounded-2xl p-8 max-w-sm w-full shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              
              <div className="flex flex-col items-center text-center mt-2">
                <div className="w-14 h-14 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center mb-5 shadow-inner">
                  <HiOutlineExclamationCircle className="w-7 h-7 text-zinc-300" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2 tracking-tight">Analysis Failed</h3>
                <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
                  {errorModalMsg}
                </p>

                <button
                  onClick={() => setErrorModalMsg(null)}
                  className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold transition-all"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ---------------------- */}

      <div className="max-w-7xl mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-cyber-500"></span>
            <span className="text-xs text-cyber-300 tracking-wide font-medium uppercase">
              Live Preview
            </span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white mb-3">
            Watch the stream in real-time
          </h2>
          <p className="text-sm text-cyber-400 max-w-md mx-auto">
            See how MockMorph generates relationally perfect data — chunk by
            chunk, directly to your terminal.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* LEFT PANE */}
          <div className="border border-white/10 bg-[#0a0a0a]/90 backdrop-blur-2xl rounded-2xl overflow-hidden shadow-2xl h-[520px] flex flex-col relative">
            <div className="flex items-center px-4 pt-4 border-b border-white/5 bg-white/[0.02] gap-2">
              <button
                onClick={() => setActiveTab("schema")}
                className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-all ${
                  activeTab === "schema"
                    ? "border-cyber-500 text-cyber-300 bg-white/5"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <HiCodeBracket className="text-lg" />
                <span className="font-mono text-[11px] tracking-wide uppercase">
                  schema.sql
                </span>
              </button>
              <button
                onClick={() => setActiveTab("config")}
                className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-all ${
                  activeTab === "config"
                    ? "border-cyber-500 text-cyber-300 bg-white/5"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <HiAdjustmentsHorizontal className="text-lg" />
                <span className="font-mono text-[11px] tracking-wide uppercase">
                  config.yml
                </span>
              </button>
            </div>

            {activeTab === "schema" && (
              <div className="flex-1 w-full flex flex-col">
                <textarea
                  aria-label="Schema SQL editor"
                  placeholder="Paste your CREATE TABLE ... statements here"
                  value={userSchemaCode}
                  onChange={(e) => setUserSchemaCode(e.target.value)}
                  className="flex-1 w-full bg-transparent text-cyber-100 font-mono text-[13px] leading-relaxed p-6 resize-none focus:outline-none custom-scrollbar"
                  spellCheck={false}
                />
                <div className="p-4 border-t border-white/5 bg-white/[0.01]">
                  <button
                    onClick={() => {
                      setActiveTab("config");
                      handleAnalyzeSchema();
                    }}
                    disabled={isAnalyzing}
                    className="w-full py-2 bg-cyber-500/20 hover:bg-cyber-500/30 border border-cyber-500/50 text-cyber-300 rounded font-mono text-xs tracking-widest uppercase transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                  >
                    {isAnalyzing ? (
                      <HiArrowPath className="animate-spin" />
                    ) : (
                      <HiBeaker />
                    )}
                    {isAnalyzing
                      ? "Analyzing Semantics..."
                      : "1. Analyze Schema"}
                  </button>
                </div>
              </div>
            )}

            {activeTab === "config" && (
              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                <div className="space-y-8">
                  
                  <div>
                    <div className="flex justify-between items-center mb-4">
                      <label htmlFor="sql-dialect" className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">
                        SQL Dialect
                      </label>
                    </div>
                    <select
                      id="sql-dialect"
                      value={sqlDialect}
                      onChange={(e) => setSqlDialect(e.target.value as "postgres" | "mysql")}
                      className="w-full bg-black/50 border border-white/10 text-[11px] font-mono text-cyber-300 rounded px-3 py-2 outline-none focus:border-cyber-500 cursor-pointer"
                    >
                      <option value="postgres">PostgreSQL</option>
                      <option value="mysql">MySQL</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-4">
                      <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">
                        Target Rows
                      </label>
                      <span className="text-xs font-mono text-cyber-400 bg-cyber-500/10 px-2 py-1 rounded border border-cyber-500/20">
                        {expectedRows}
                      </span>
                    </div>
                    <input
                      aria-label="Target rows slider"
                      type="range"
                      min="10"
                      max="500"
                      step="10"
                      value={expectedRows}
                      onChange={(e) => setExpectedRows(Number(e.target.value))}
                      className="w-full accent-cyber-500 bg-white/10 h-1 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="pt-4 border-t border-white/5">
                    <div className="flex justify-between items-center mb-4">
                      <label className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                        AI Semantic Overrides
                      </label>
                      {quotaRemaining !== null && !isAnalyzing && (
                        <span className="text-[10px] font-mono text-cyber-400 bg-cyber-500/10 px-2 py-0.5 rounded border border-cyber-500/20">
                          Quota: {quotaRemaining}/5
                        </span>
                      )}
                      {!schemaMapping && !isAnalyzing && (
                        <button
                          onClick={handleAnalyzeSchema}
                          className="text-[10px] font-mono text-cyber-400 hover:text-cyber-300"
                        >
                          Run Analysis
                        </button>
                      )}
                    </div>

                    {isAnalyzing && (
                      <div className="text-center py-6 border border-white/5 border-dashed rounded-lg">
                        <HiArrowPath className="text-cyber-500 text-xl animate-spin mx-auto mb-2" />
                        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                          Extracting Topology...
                        </span>
                      </div>
                    )}

                    {!isAnalyzing && !schemaMapping && (
                      <div className="w-full h-24 border border-white/5 border-dashed rounded-lg flex items-center justify-center bg-white/[0.01]">
                        <span className="text-[10px] font-mono text-zinc-600 uppercase">
                          Awaiting Schema Analysis...
                        </span>
                      </div>
                    )}

                    {!isAnalyzing && schemaMapping && (
                      <div className="space-y-4">
                        {schemaMapping.topology.map((tableName) => {
                          const columns = schemaMapping.tables[tableName] || {};
                          return (
                            <div
                              key={tableName}
                              className="bg-white/[0.02] border border-white/5 rounded overflow-hidden"
                            >
                              <div className="bg-white/5 px-3 py-2 border-b border-white/5">
                                <span className="text-[10px] font-mono text-cyber-300 font-bold tracking-widest uppercase">
                                  {tableName}
                                </span>
                              </div>
                              <div className="p-3 space-y-2">
                                {Object.entries(columns).map(([col, type]) => (
                                  <div
                                    key={col}
                                    className="flex justify-between items-center"
                                  >
                                    <span className="text-[11px] font-mono text-zinc-400">
                                      {col}
                                    </span>
                                    <select
                                      value={type.toLowerCase()}
                                      onChange={(e) =>
                                        handleMappingChange(
                                          tableName,
                                          col,
                                          e.target.value,
                                        )
                                      }
                                      title={`Select semantic type for column ${col}`}
                                      className="bg-black/50 border border-white/10 text-[10px] font-mono text-zinc-300 rounded px-2 py-1 outline-none focus:border-cyber-500 cursor-pointer"
                                    >
                                      {semanticTypes.map((t) => (
                                        <option key={t} value={t}>
                                          {t}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT PANE: Terminal */}
          <div className="border border-white/10 bg-[#0a0a0a]/90 backdrop-blur-2xl rounded-2xl overflow-hidden shadow-2xl h-[520px] flex flex-col relative">
            <div className="crt-overlay" />
            <div className="crt-scanline" />

            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 bg-white/[0.02] relative z-20">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]/80" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]/80" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]/80" />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      isGenerating
                        ? "bg-[#febc2e] animate-pulse"
                        : isComplete
                        ? "bg-[#28c840]"
                        : "bg-[#28c840]/50"
                    }`}
                  />
                  <span className="text-[10px] text-cyber-500 font-mono uppercase">
                    {isGenerating
                      ? "Streaming"
                      : isComplete
                      ? "Finished"
                      : "Ready"}
                    {status !== "idle" && ` (${elapsedTime.toFixed(1)}s)`}
                  </span>
                </div>
                
                {/* --- PREMIUM CTA GENERATE BUTTON --- */}
                <motion.button
                  onClick={handleStartGeneration}
                  disabled={isGenerating || !schemaMapping}
                  title={!schemaMapping ? "Analyze schema first" : ""}
                  animate={
                    isReadyToGenerate
                      ? {
                          boxShadow: [
                            "0px 0px 0px 0px rgba(34, 211, 238, 0.4)",
                            "0px 0px 0px 6px rgba(34, 211, 238, 0)",
                          ],
                        }
                      : { boxShadow: "0px 0px 0px 0px rgba(34, 211, 238, 0)" }
                  }
                  transition={{ duration: 1.5, repeat: isReadyToGenerate ? Infinity : 0 }}
                  className={`relative flex items-center gap-1.5 px-4 py-1.5 rounded-lg border transition-all duration-300 overflow-hidden ${
                    isReadyToGenerate
                      ? "bg-cyber-500/20 border-cyber-400/50 text-white cursor-pointer hover:bg-cyber-500/30"
                      : isComplete
                      ? "bg-white/5 border-white/20 text-cyber-300 hover:bg-white/10 cursor-pointer"
                      : "bg-white/5 border-white/10 text-zinc-600 opacity-40 cursor-not-allowed"
                  }`}
                >
                  {isReadyToGenerate && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[-20deg]"
                      animate={{ x: ["-200%", "200%"] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                  
                  <span className="relative flex items-center gap-1.5 z-10">
                    {isComplete ? (
                      <HiArrowPath className="text-xs" />
                    ) : (
                      <HiPlay className="text-xs" />
                    )}
                    <span className="text-[11px] font-mono font-bold tracking-wider uppercase">
                      {isComplete ? "Replay" : "2. Generate"}
                    </span>
                  </span>
                </motion.button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 p-6 font-mono text-[13px] leading-relaxed overflow-y-auto bg-transparent scroll-smooth relative z-20 custom-scrollbar"
            >
              <AnimatePresence mode="popLayout">
                {lines.length === 0 && status === "idle" && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-cyber-600"
                  >
                    $ Waiting for execution...
                  </motion.div>
                )}
                {lines.map((line) => (
                  <TerminalLine key={line.id} line={line} />
                ))}
                {isGenerating && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-2 text-cyber-600 flex items-center"
                  >
                    ${" "}
                    <span className="w-2 h-4 bg-cyber-500 ml-1 animate-pulse inline-block align-middle" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-white/5 bg-black/40 relative z-20">
              <div className="flex items-center gap-4 w-1/2">
                <span className="text-[10px] font-mono text-cyber-600 uppercase">
                  Stream
                </span>
                <progress
                  className="w-full max-w-[120px] h-1 rounded-full overflow-hidden bg-white/5 [&::-webkit-progress-bar]:bg-white/5 [&::-webkit-progress-value]:bg-cyber-500 [&::-moz-progress-bar]:bg-cyber-500 shadow-[0_0_8px_#06b6d4]"
                  value={progressPercentage}
                  max={100}
                  aria-label="Stream progress"
                />
                <span className="text-[10px] font-mono text-cyber-500 whitespace-nowrap">
                  {sqlLinesCount} / {expectedRows}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  disabled={!isComplete || !fullSql}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-zinc-300 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  {copied ? (
                    <HiCheck className="text-sm text-green-400" />
                  ) : (
                    <HiClipboardDocument className="text-sm" />
                  )}
                  <span className={copied ? "text-green-400" : ""}>
                    {copied ? "COPIED!" : "COPY"}
                  </span>
                </button>
                <button
                  onClick={handleDownload}
                  disabled={!isComplete || !fullSql}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyber-500/10 border border-cyber-500/30 text-[10px] font-mono text-cyber-400 hover:bg-cyber-500/20 hover:text-cyber-300 transition-all disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <HiArrowDownTray className="text-sm" />
                  .SQL
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const TerminalLine = React.memo(({ line }: { line: TerminalLine }) => {
  if (line.type === "blank") return <div className="h-4" />;
  const getStyles = () => {
    switch (line.type) {
      case "system":
        return { prefix: "[SYS]", color: "text-zinc-500" };
      case "ai":
        return { prefix: "[AI]", color: "text-purple-400" };
      case "edge":
        return { prefix: "[EDGE]", color: "text-blue-400" };
      case "sql":
        return { prefix: "", color: "text-zinc-300 pl-4" };
      case "complete":
        return { prefix: "[DONE]", color: "text-green-400" };
      case "error":
        return { prefix: "[FAIL]", color: "text-red-400" };
      default:
        return { prefix: "", color: "text-zinc-400" };
    }
  };
  const { prefix, color } = getStyles();

  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.1 }}
      className={`flex items-start mb-0.5 ${color}`}
    >
      {prefix && (
        <span className="mr-3 text-[10px] font-bold opacity-60 mt-0.5 shrink-0 tracking-tighter">
          {prefix}
        </span>
      )}
      <span
        className={
          line.content.startsWith("INSERT") ? "text-cyber-400 mt-2 block" : ""
        }
      >
        {line.content}
      </span>
    </motion.div>
  );
});

TerminalLine.displayName = "TerminalLine";