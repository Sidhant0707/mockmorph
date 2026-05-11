"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  HiOutlineCodeBracketSquare,
  HiOutlineDocumentText,
  HiCheck,
  HiClipboardDocument,
} from "react-icons/hi2";

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <HiCheck className="w-4 h-4 text-green-400" />
      ) : (
        <HiClipboardDocument className="w-4 h-4" />
      )}
    </button>
  );
};

export default function DocsSection() {
  return (
    <section id="docs" className="relative z-10 py-32 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6 sm:px-8">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-20"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-6">
            <HiOutlineDocumentText className="text-cyber-400" />
            <span className="text-xs text-cyber-300 tracking-wide font-medium uppercase">
              Developer API
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
            Integrate the Edge Engine.
          </h2>
          <p className="text-earth-400 max-w-2xl text-lg">
            MockMorph provides a headless REST API, allowing you to synthesize
            relational data directly within your CI/CD pipelines or local
            testing scripts.
          </p>
        </motion.div>

        <div className="space-y-24">
          {/* Endpoint 1: Generation */}
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left side: Docs */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="px-2 py-1 rounded bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono font-bold tracking-widest uppercase">
                  POST
                </span>
                <code className="text-white font-mono text-sm">
                  /api/generate
                </code>
              </div>
              <h3 className="text-xl font-bold text-white mb-3">
                Synthesize Payload
              </h3>
              <p className="text-earth-400 text-sm mb-6 leading-relaxed">
                Stream a structurally sound SQL or JSON payload based on an
                input schema. The engine uses Kahn&apos;s Algorithm to resolve
                foreign key constraints before streaming.
              </p>

              <div className="space-y-4">
                <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
                  Parameters
                </h4>
                <div className="border border-white/10 rounded-xl bg-earth-900/40 backdrop-blur-md overflow-hidden">
                  <div className="grid grid-cols-3 p-4 border-b border-white/5 bg-white/[0.02]">
                    <div className="text-xs font-bold text-white">
                      rawSchema
                    </div>
                    <div className="text-xs font-mono text-cyber-400">
                      string
                    </div>
                    <div className="text-xs text-zinc-400">
                      Required. The SQL schema to parse.
                    </div>
                  </div>
                  <div className="grid grid-cols-3 p-4 border-b border-white/5">
                    <div className="text-xs font-bold text-white">
                      config.rowCount
                    </div>
                    <div className="text-xs font-mono text-cyber-400">
                      integer
                    </div>
                    <div className="text-xs text-zinc-400">
                      Default: 50. Max: 10,000.
                    </div>
                  </div>
                  <div className="grid grid-cols-3 p-4">
                    <div className="text-xs font-bold text-white">
                      config.dialect
                    </div>
                    <div className="text-xs font-mono text-cyber-400">
                      string
                    </div>
                    <div className="text-xs text-zinc-400">
                      &quot;postgres&quot; | &quot;mysql&quot;
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Right side: Code snippet */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="border border-white/10 bg-[#0a0a0c]/95 backdrop-blur-2xl rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <HiOutlineCodeBracketSquare className="text-zinc-500" />
                  <span className="text-[11px] font-mono text-zinc-400 tracking-wider">
                    cURL Example
                  </span>
                </div>
                <CopyButton
                  text={`curl -X POST https://mockmorph.com/api/generate \
-H "Content-Type: application/json" \
-H "Authorization: Bearer YOUR_API_KEY" \
-d '{
  "rawSchema": "CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR);",
  "config": {
    "rowCount": 100,
    "dialect": "postgres"
  }
}'`}
                />
              </div>
              <div className="p-6 overflow-x-auto custom-scrollbar">
                <pre className="text-[12px] font-mono leading-relaxed">
                  <span className="text-blue-400">curl</span>{" "}
                  <span className="text-zinc-300">
                    -X POST https://mockmorph.com/api/generate \
                  </span>
                  <br />
                  <span className="text-zinc-300"> -H </span>
                  <span className="text-green-400">
                    &quot;Content-Type: application/json&quot;
                  </span>
                  <span className="text-zinc-300"> \</span>
                  <br />
                  <span className="text-zinc-300"> -H </span>
                  <span className="text-green-400">
                    &quot;Authorization: Bearer YOUR_API_KEY&quot;
                  </span>
                  <span className="text-zinc-300"> \</span>
                  <br />
                  <span className="text-zinc-300"> -d </span>
                  <span className="text-cyber-400">{"{"}&apos;</span>
                  <br />
                  <span className="text-cyber-400">
                    {" "}
                    &quot;rawSchema&quot;: &quot;CREATE TABLE users (id SERIAL
                    PRIMARY KEY, email VARCHAR);&quot;,
                  </span>
                  <br />
                  <span className="text-cyber-400">
                    {" "}
                    &quot;config&quot;: {"{"}
                  </span>
                  <br />
                  <span className="text-cyber-400">
                    {" "}
                    &quot;rowCount&quot;: 100,
                  </span>
                  <br />
                  <span className="text-cyber-400">
                    {" "}
                    &quot;dialect&quot;: &quot;postgres&quot;
                  </span>
                  <br />
                  <span className="text-cyber-400"> {"}"}</span>
                  <br />
                  <span className="text-cyber-400"> {"}"}&apos;</span>
                </pre>
              </div>
            </motion.div>
          </div>

          {/* Endpoint 2: Analyze */}
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left side: Docs */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="px-2 py-1 rounded bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono font-bold tracking-widest uppercase">
                  POST
                </span>
                <code className="text-white font-mono text-sm">
                  /api/analyze
                </code>
              </div>
              <h3 className="text-xl font-bold text-white mb-3">
                Schema Intelligence
              </h3>
              <p className="text-earth-400 text-sm mb-6 leading-relaxed">
                Utilize the LLM router to extract database topology and map
                abstract column names to explicit semantic data types.
              </p>

              <div className="space-y-4">
                <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
                  Response Schema
                </h4>
                <div className="border border-white/10 rounded-xl bg-earth-900/40 backdrop-blur-md overflow-hidden">
                  <div className="grid grid-cols-3 p-4 border-b border-white/5 bg-white/[0.02]">
                    <div className="text-xs font-bold text-white">topology</div>
                    <div className="text-xs font-mono text-cyber-400">
                      string[]
                    </div>
                    <div className="text-xs text-zinc-400">
                      Ordered array for safe inserts.
                    </div>
                  </div>
                  <div className="grid grid-cols-3 p-4">
                    <div className="text-xs font-bold text-white">tables</div>
                    <div className="text-xs font-mono text-cyber-400">
                      Object
                    </div>
                    <div className="text-xs text-zinc-400">
                      Map of table columns to semantic types.
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Right side: Code snippet */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="border border-white/10 bg-[#0a0a0c]/95 backdrop-blur-2xl rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <HiOutlineCodeBracketSquare className="text-zinc-500" />
                  <span className="text-[11px] font-mono text-zinc-400 tracking-wider">
                    Response JSON
                  </span>
                </div>
                <CopyButton
                  text={`{
  "topology": ["users", "orders"],
  "tables": {
    "users": {
      "id": "pk",
      "email": "email"
    }
  }
}`}
                />
              </div>
              <div className="p-6 overflow-x-auto custom-scrollbar">
                <pre className="text-[12px] font-mono leading-relaxed">
                  <span className="text-zinc-300">{"{"}</span>
                  <br />
                  <span className="text-cyber-400"> &quot;topology&quot;</span>
                  <span className="text-zinc-300">: [</span>
                  <span className="text-green-400">&quot;users&quot;</span>
                  <span className="text-zinc-300">, </span>
                  <span className="text-green-400">&quot;orders&quot;</span>
                  <span className="text-zinc-300">],</span>
                  <br />
                  <span className="text-cyber-400"> &quot;tables&quot;</span>
                  <span className="text-zinc-300">: {"{"}</span>
                  <br />
                  <span className="text-cyber-400"> &quot;users&quot;</span>
                  <span className="text-zinc-300">: {"{"}</span>
                  <br />
                  <span className="text-cyber-400"> &quot;id&quot;</span>
                  <span className="text-zinc-300">: </span>
                  <span className="text-green-400">&quot;pk&quot;</span>
                  <span className="text-zinc-300">,</span>
                  <br />
                  <span className="text-cyber-400"> &quot;email&quot;</span>
                  <span className="text-zinc-300">: </span>
                  <span className="text-green-400">&quot;email&quot;</span>
                  <br />
                  <span className="text-zinc-300"> {"}"}</span>
                  <br />
                  <span className="text-zinc-300"> {"}"}</span>
                  <br />
                  <span className="text-zinc-300">{"}"}</span>
                </pre>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
