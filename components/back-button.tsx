"use client";

import { useRouter } from "next/navigation";
import { HiArrowLeft } from "react-icons/hi2";

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-2 text-[11px] font-mono text-zinc-500 hover:text-cyber-400 uppercase tracking-widest transition-colors mb-6 group cursor-pointer"
    >
      <HiArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
      Return to Engine
    </button>
  );
}
