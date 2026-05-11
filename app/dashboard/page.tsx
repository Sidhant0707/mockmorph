import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import CopyButton from "@/components/copy-button";
import BackButton from "@/components/back-button";
import {
  HiOutlineCircleStack,
  HiOutlineClock,
  HiArrowRight,
  HiPlus,
  HiOutlineKey,
  HiOutlineBolt,
  HiOutlineCodeBracketSquare,
} from "react-icons/hi2";
import { FaGithub, FaLinkedin } from "react-icons/fa6";

interface SessionUser {
  id?: string;
}

interface GenerationRecord {
  id: string;
  createdAt: Date;
  schema: string;
  mockData: string;
}

export const metadata = {
  title: "Command Center | MockMorph",
  description: "Manage your synthesized database architectures.",
};

export default async function Dashboard() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as SessionUser | undefined)?.id;

  if (!userId) {
    redirect("/login");
  }

  // Fetch history directly on the server
  const generations: GenerationRecord[] = await prisma.generation.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="min-h-screen text-[#f1f5f9] pt-28 pb-12 px-4 sm:px-8 md:px-12 lg:px-24 font-sans relative overflow-hidden">
      {/* Background Architectural Grid & Subtle Cyber Glow */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-to-b from-cyber-500/10 via-transparent to-transparent pointer-events-none z-0 blur-3xl rounded-full" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* State-Preserving Client Back Button */}
        <BackButton />

        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16 border-b border-white/5 pb-8">
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md shadow-[0_0_30px_rgba(96,165,250,0.15)]">
                <HiOutlineCircleStack className="w-8 h-8 text-cyber-400" />
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight">
                Command Center
              </h1>
            </div>
            <p className="text-earth-300 text-sm md:text-base max-w-2xl leading-relaxed">
              Access your historical data syntheses. All schema topologies, AI
              diagnostic mapping, and generated JSON/SQL payloads are cached on
              the edge and ready for deployment.
            </p>
          </div>
          <Link
            href="/"
            className="px-6 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white backdrop-blur-md font-bold text-xs uppercase tracking-[0.15em] hover:bg-white/20 transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,255,255,0.05)] w-full md:w-fit group"
          >
            <HiPlus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
            New Synthesis
          </Link>
        </header>

        {/* Workspace Tools (SaaS Expansion Teasers) */}
        <div className="mb-16">
          <h2 className="text-xs font-mono text-earth-400 uppercase tracking-widest mb-6">
            Infrastructure Tools
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Tool 1: API Keys */}
            <div className="flex items-center gap-4 bg-earth-900/40 backdrop-blur-xl border border-white/10 hover:border-white/20 transition-all px-6 py-5 rounded-2xl cursor-not-allowed group relative overflow-hidden shadow-xl">
              <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                <HiOutlineKey className="w-6 h-6 text-earth-300" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-white font-bold text-sm">
                    API Key Manager
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-cyber-500/10 border border-cyber-500/20 text-cyber-400 text-[9px] font-black tracking-widest uppercase">
                    Soon
                  </span>
                </div>
                <p className="text-earth-400 text-xs mt-1">
                  Generate dynamic data via cURL
                </p>
              </div>
            </div>

            {/* Tool 2: Webhooks */}
            <div className="flex items-center gap-4 bg-earth-900/40 backdrop-blur-xl border border-white/10 hover:border-white/20 transition-all px-6 py-5 rounded-2xl cursor-not-allowed group relative overflow-hidden shadow-xl">
              <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                <HiOutlineBolt className="w-6 h-6 text-earth-300" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-white font-bold text-sm">
                    Webhook Triggers
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-cyber-500/10 border border-cyber-500/20 text-cyber-400 text-[9px] font-black tracking-widest uppercase">
                    Soon
                  </span>
                </div>
                <p className="text-earth-400 text-xs mt-1">
                  Automate CI/CD database seeding
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Historical Scans Area */}
        <div className="mb-20">
          <h2 className="text-xs font-mono text-earth-400 uppercase tracking-widest mb-6">
            Cached Syntheses
          </h2>

          {generations.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 md:p-20 rounded-3xl border border-white/10 bg-earth-900/40 text-center backdrop-blur-xl shadow-2xl">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-cyber-500/20 blur-xl rounded-full" />
                <HiOutlineCodeBracketSquare className="w-14 h-14 text-earth-500 relative z-10" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">
                No Architectures Found
              </h3>
              <p className="text-earth-400 text-sm mb-8 max-w-md">
                Your archive is currently empty. Initialize the edge engine and
                generate your first batch of relational mock data to see it
                cached here.
              </p>
              <Link
                href="/"
                className="px-8 py-3.5 rounded-xl bg-white/5 text-white border border-white/10 font-bold text-xs uppercase tracking-[0.15em] hover:bg-white/10 transition-all w-full sm:w-fit backdrop-blur-md"
              >
                Initialize Engine
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {generations.map((gen: GenerationRecord) => (
                <div
                  key={gen.id}
                  className="group flex flex-col rounded-3xl border border-white/10 bg-earth-900/40 backdrop-blur-xl hover:bg-earth-800/50 hover:border-white/20 transition-all duration-500 shadow-2xl overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-cyber-500/10 border border-cyber-500/20 rounded-lg">
                        <HiOutlineCircleStack className="w-4 h-4 text-cyber-400" />
                      </div>
                      <span className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-300">
                        REF_ID: {gen.id.slice(-8)}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-earth-400 flex items-center gap-2">
                      <HiOutlineClock className="w-3.5 h-3.5" />
                      {new Date(gen.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  {/* Card Body (Code Panes) */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-white/5">
                    {/* Left Pane: Input Schema */}
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-bold text-earth-300 uppercase tracking-wider flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-earth-500" />
                          Source Schema
                        </h3>
                        <CopyButton textToCopy={gen.schema} />
                      </div>
                      <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-white/5 p-4 h-64 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar relative shadow-inner">
                        {/* whitespace-pre-wrap and break-words eliminate horizontal trackpad stealing */}
                        <pre className="text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
                          {gen.schema}
                        </pre>
                      </div>
                    </div>

                    {/* Right Pane: Generated Output */}
                    <div className="p-6 bg-gradient-to-br from-transparent to-cyber-900/10">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-bold text-cyber-400 uppercase tracking-wider flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-cyber-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                          Generated Payload
                        </h3>
                        <CopyButton textToCopy={gen.mockData} />
                      </div>
                      <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-cyber-500/10 p-4 h-64 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar relative shadow-inner">
                        {/* whitespace-pre-wrap and break-words eliminate horizontal trackpad stealing */}
                        <pre className="text-[11px] leading-relaxed font-mono text-cyber-100 whitespace-pre-wrap break-words">
                          {gen.mockData}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="px-6 py-3 border-t border-white/5 bg-white/[0.02] flex justify-end">
                    <button className="text-[10px] uppercase tracking-widest font-bold text-earth-400 hover:text-cyber-400 transition-colors flex items-center gap-2">
                      Analyze Query Performance{" "}
                      <HiArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-24 border-t border-white/10 pt-8 pb-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex flex-col items-center md:items-start">
              <span className="text-xl font-bold tracking-tight mb-2">
                <span className="text-cyber-400">Mock</span>
                <span className="text-white">Morph</span>
              </span>
              <p className="text-earth-500 text-[11px] font-medium tracking-tight uppercase">
                © {new Date().getFullYear()} MockMorph Inc. All rights reserved.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {[
                { Icon: FaGithub, href: "https://github.com/Sidhant0707" },
                {
                  Icon: FaLinkedin,
                  href: "https://www.linkedin.com/in/sidhant07",
                },
              ].map((social, i) => {
                const IconComponent = social.Icon;
                const socialName = social.Icon === FaGithub ? "GitHub" : "LinkedIn";
                return (
                  <a
                    key={i}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={socialName}
                    aria-label={socialName}
                    className="w-10 h-10 rounded-lg bg-earth-900/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-earth-400 hover:text-white hover:border-white/20 transition-all shadow-lg"
                  >
                    <IconComponent className="w-4 h-4" />
                  </a>
                );
              })}
            </div>
          </div>
        </footer>
      </div>

      {/* Global CSS for the custom scrollbar in code blocks */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `,
        }}
      />
    </div>
  );
}
