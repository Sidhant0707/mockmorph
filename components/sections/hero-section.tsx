"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
} from "framer-motion";
import { HiOutlineSparkles, HiOutlineBookOpen } from "react-icons/hi2";

const fadeInUp = {
  initial: { opacity: 0, y: 40 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: [0.23, 1, 0.32, 1] },
};

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.1 } },
};

export default function HeroSection() {
  const containerRef = useRef<HTMLElement>(null);
  const [badgeState, setBadgeState] = useState({
    text: "compiling...",
    color: "bg-yellow-500",
    pulse: true,
  });

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springConfig = { damping: 25, stiffness: 100 };
  const springX = useSpring(mouseX, springConfig);
  const springY = useSpring(mouseY, springConfig);

  const rotateX = useTransform(springY, [-500, 500], [5, -5]);
  const rotateY = useTransform(springX, [-500, 500], [-5, 5]);
  const translateX = useTransform(springX, [-500, 500], [-15, 15]);
  const translateY = useTransform(springY, [-500, 500], [-15, 15]);

  useEffect(() => {
    const sequence = async () => {
      await new Promise((r) => setTimeout(r, 600));
      setBadgeState({
        text: "linking modules...",
        color: "bg-yellow-500",
        pulse: true,
      });
      await new Promise((r) => setTimeout(r, 500));
      setBadgeState({
        text: "resolving dependencies...",
        color: "bg-yellow-500",
        pulse: true,
      });
      await new Promise((r) => setTimeout(r, 700));
      setBadgeState({
        text: "build complete ✓",
        color: "bg-green-500",
        pulse: false,
      });
      await new Promise((r) => setTimeout(r, 400));
      setBadgeState({
        text: "Next.js 15 + Edge Streaming",
        color: "bg-cyber-500",
        pulse: true,
      });
    };
    sequence();

    const handleMouseMove = (e: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      mouseX.set(e.clientX - innerWidth / 2);
      mouseY.set(e.clientY - innerHeight / 2);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mouseX, mouseY]);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });

  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const editorY = useTransform(scrollYProgress, [0, 1], ["0%", "15%"]);
  const editorRotateX = useTransform(scrollYProgress, [0, 1], [0, 8]);

  return (
    <section
      ref={containerRef}
      id="hero"
      className="relative z-10 pt-24 sm:pt-32 pb-16 sm:pb-24 min-h-screen flex items-center overflow-hidden"
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .perspective-grid {
            background-size: 50px 50px;
            background-image: 
              linear-gradient(to right, rgba(6, 182, 212, 0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(6, 182, 212, 0.05) 1px, transparent 1px);
            transform-style: preserve-3d;
            mask-image: linear-gradient(to bottom, black 40%, transparent 100%);
          }
          .magnetic-button {
            transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
          }
          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
          }
          .stat-card {
            transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
          }
          .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 10px 30px rgba(6, 182, 212, 0.2);
          }
        `,
        }}
      />

      <motion.div
        className="absolute inset-0 z-0 pointer-events-none perspective-grid"
        style={{ rotateX, rotateY, x: translateX, y: translateY, scale: 1.1 }}
      />

      <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[400px] h-[400px] bg-cyber-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 sm:px-8 w-full relative z-10">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          <motion.div className="lg:col-span-6" style={{ y: textY }}>
            <motion.div
              initial="initial"
              animate="animate"
              variants={staggerContainer}
            >
              <motion.div
                variants={fadeInUp}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel mb-6 sm:mb-8 border border-white/10 bg-white/5 backdrop-blur-md hover:border-cyber-400/30 hover:bg-white/10 transition-all cursor-default"
                whileHover={{ scale: 1.05 }}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${badgeState.color} ${badgeState.pulse ? "animate-pulse" : ""} transition-colors duration-300`}
                ></span>
                <span className="text-[10px] sm:text-xs font-mono text-cyber-400 tracking-wide transition-all duration-300">
                  {badgeState.text}
                </span>
              </motion.div>

              <motion.h1
                variants={fadeInUp}
                className="text-4xl sm:text-5xl md:text-[4.5rem] leading-[1.1] sm:leading-[1.05] font-extrabold tracking-tight mb-4 sm:mb-6"
              >
                <span className="text-white block">Production-grade</span>
                <span className="text-white block">mock data.</span>
                <span className="bg-gradient-to-br from-cyber-200 via-cyber-400 to-cyber-600 bg-clip-text text-transparent block mt-1">
                  Zero privacy violations.
                </span>
              </motion.h1>

              <motion.p
                variants={fadeInUp}
                className="text-sm sm:text-base md:text-lg leading-relaxed text-cyber-400 max-w-lg mb-8 sm:mb-10 font-normal"
              >
                Stop risking GDPR leaks with production data DB dumps. Generate
                relationally perfect SQL directly to your local machine using a
                Hybrid LLM-Deterministic Edge engine.
              </motion.p>

              <motion.div
                variants={fadeInUp}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto"
              >
                <MagneticButton
                  onClick={() =>
                    document
                      .querySelector("#terminal")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="group flex justify-center items-center gap-2.5 px-7 py-3.5 rounded-xl bg-white text-cyber-950 text-sm font-bold hover:bg-cyber-200 transition-all duration-300 w-full sm:w-auto relative overflow-hidden"
                >
                  <span className="relative z-10">Generate My Schema</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-cyber-400 to-cyber-600 opacity-0 group-hover:opacity-20 transition-opacity" />
                </MagneticButton>
                <a
                  href="#features"
                  className="flex justify-center items-center gap-2 px-6 py-3.5 rounded-xl text-sm font-medium text-cyber-400 hover:text-white border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all duration-300 w-full sm:w-auto group"
                >
                  <HiOutlineBookOpen className="text-lg group-hover:rotate-12 transition-transform" />
                  View Architecture
                </a>
              </motion.div>

              <motion.div
                variants={fadeInUp}
                className="flex flex-wrap items-center gap-6 sm:gap-10 mt-10 sm:mt-14 pt-8 border-t border-white/10"
              >
                {[
                  { value: "10M+", label: "Rows Generated" },
                  { value: "<8s", label: "Avg. Generation" },
                  { value: "100%", label: "FK Integrity" },
                ].map((stat, idx) => (
                  <motion.div
                    key={idx}
                    className="stat-card cursor-default"
                    whileHover={{ scale: 1.05 }}
                  >
                    <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                      {stat.value}
                    </div>
                    <div className="text-[10px] sm:text-xs text-cyber-500 mt-1 font-medium uppercase tracking-wider">
                      {stat.label}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          </motion.div>

          <motion.div
            className="lg:col-span-6 relative w-full hidden sm:block"
            style={{
              y: editorY,
              rotateX: editorRotateX,
              transformPerspective: 1000,
            }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
            whileHover={{ scale: 1.02, rotateX: 2 }}
          >
            <motion.div
              className="absolute -inset-4 rounded-2xl opacity-20 blur-3xl bg-gradient-to-br from-cyber-600 to-transparent pointer-events-none"
              animate={{ opacity: [0.2, 0.3, 0.2] }}
              transition={{ duration: 3, repeat: Infinity }}
            />

            <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl shadow-black/50 w-full overflow-x-auto custom-scrollbar hover:border-cyber-500/30 transition-all">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/5 min-w-[500px]">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]/80 hover:bg-[#ff5f57] transition-colors cursor-pointer" />
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]/80 hover:bg-[#febc2e] transition-colors cursor-pointer" />
                  <div className="w-3 h-3 rounded-full bg-[#28c840]/80 hover:bg-[#28c840] transition-colors cursor-pointer" />
                </div>
                <span className="text-[11px] font-mono text-cyber-500 tracking-wider">
                  schema.sql
                </span>
                <div className="w-12" />
              </div>

              <div className="p-4 sm:p-6 font-mono text-[11px] sm:text-[13px] leading-relaxed min-w-[500px]">
                <div className="text-cyber-600">
                  -- Define your production schema
                </div>
                <div className="mt-3">
                  <span className="text-blue-400 font-medium">
                    CREATE TABLE
                  </span>
                  <span className="text-white"> users </span>
                  <span className="text-cyber-500">(</span>
                </div>
                <div className="pl-6 text-cyber-300">
                  <div>
                    id &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                    <span className="text-purple-400">SERIAL PRIMARY KEY</span>,
                  </div>
                  <div>
                    email &nbsp;&nbsp;&nbsp;
                    <span className="text-purple-400">
                      VARCHAR(255) UNIQUE NOT NULL
                    </span>
                    ,
                  </div>
                  <div>
                    name &nbsp;&nbsp;&nbsp;&nbsp;
                    <span className="text-purple-400">
                      VARCHAR(100) NOT NULL
                    </span>
                    ,
                  </div>
                  <div>
                    role &nbsp;&nbsp;&nbsp;&nbsp;
                    <span className="text-purple-400">
                      VARCHAR(50) DEFAULT
                    </span>{" "}
                    <span className="text-green-400">&apos;user&apos;</span>,
                  </div>
                  <div>
                    created &nbsp;
                    <span className="text-purple-400">
                      TIMESTAMP DEFAULT NOW()
                    </span>
                  </div>
                </div>
                <div className="text-cyber-500">);</div>

                <div className="mt-5">
                  <span className="text-blue-400 font-medium">
                    CREATE TABLE
                  </span>
                  <span className="text-white"> orders </span>
                  <span className="text-cyber-500">(</span>
                </div>
                <div className="pl-6 text-cyber-300">
                  <div>
                    id &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                    <span className="text-purple-400">SERIAL PRIMARY KEY</span>,
                  </div>
                  <div>
                    user_id &nbsp;
                    <span className="text-purple-400">INT REFERENCES</span>{" "}
                    <span className="text-white">users</span>
                    <span className="text-cyber-500">(</span>id
                    <span className="text-cyber-500">)</span>,
                  </div>
                  <div>
                    amount &nbsp;&nbsp;
                    <span className="text-purple-400">
                      DECIMAL(10,2) NOT NULL
                    </span>
                  </div>
                </div>
                <div className="text-cyber-500">);</div>

                <div className="mt-4 flex items-center">
                  <motion.span
                    className="w-2 h-4 bg-cyber-500 inline-block"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40 hover:opacity-70 transition-opacity cursor-pointer"
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-cyber-500 font-mono">
          Scroll
        </span>
        <div className="w-px h-8 bg-gradient-to-b from-cyber-500 to-transparent" />
      </motion.div>
    </section>
  );
}

// Magnetic Button Component
function MagneticButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setPosition({ x: x * 0.3, y: y * 0.3 });
  };

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 });
  };

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`magnetic-button ${className}`}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      {children}
    </motion.button>
  );
}