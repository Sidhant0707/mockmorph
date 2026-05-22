"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import {
  Zap,
  Database,
  Terminal,
  Loader2,
  Mail,
  Lock,
} from "lucide-react";
import { FaGithub } from "react-icons/fa6";
import { FcGoogle } from "react-icons/fc";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
}

export default function LoginPage() {
  const [oauthLoading, setOauthLoading] = useState<"github" | "google" | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);

  const formRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const formMouseX = useMotionValue(0);
  const formMouseY = useMotionValue(0);

  const springConfig = { damping: 25, stiffness: 100 };
  const springX = useSpring(mouseX, springConfig);
  const springY = useSpring(mouseY, springConfig);

  const rotateX = useTransform(springY, [-500, 500], [5, -5]);
  const rotateY = useTransform(springX, [-500, 500], [-5, 5]);
  const translateX = useTransform(springX, [-500, 500], [-20, 20]);
  const translateY = useTransform(springY, [-500, 500], [-20, 20]);

  const cardRotateX = useTransform(formMouseY, [-300, 300], [10, -10]);
  const cardRotateY = useTransform(formMouseX, [-300, 300], [-10, 10]);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      setParticles(
        Array.from({ length: 50 }, (_, i) => ({
          id: i,
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          size: Math.random() * 3 + 1,
          opacity: Math.random() * 0.5 + 0.2,
          duration: 3 + Math.random() * 4,
        })),
      );
    });

    const handleMouseMove = (e: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      mouseX.set(e.clientX - innerWidth / 2);
      mouseY.set(e.clientY - innerHeight / 2);

      if (formRef.current) {
        const rect = formRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        formMouseX.set(e.clientX - centerX);
        formMouseY.set(e.clientY - centerY);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [mouseX, mouseY, formMouseX, formMouseY]);

  async function handleOAuth(provider: "github" | "google") {
    setOauthLoading(provider);
    setError(null);

    try {
      await signIn(provider, { callbackUrl: "/" });
    } catch (err) {
      setError("Authentication failed. Please try again.");
      setOauthLoading(null);
    }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setEmailLoading(true);
    setError(null);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/",
      });

      if (result?.error) {
        setError("Invalid email or password.");
        setEmailLoading(false);
      } else {
        window.location.href = "/";
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
      setEmailLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#f1f5f9] flex flex-col md:flex-row overflow-hidden relative">
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .perspective-grid {
            background-size: 50px 50px;
            background-image: 
              linear-gradient(to right, rgba(6, 182, 212, 0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(6, 182, 212, 0.05) 1px, transparent 1px);
            transform-style: preserve-3d;
            mask-image: radial-gradient(ellipse at center, black 20%, transparent 70%);
          }
          
          @keyframes shimmer {
            0% { background-position: -1000px 0; }
            100% { background-position: 1000px 0; }
          }
          
          .shimmer {
            background: linear-gradient(
              90deg,
              transparent,
              rgba(6, 182, 212, 0.1),
              transparent
            );
            background-size: 1000px 100%;
            animation: shimmer 3s infinite;
          }

          .magnetic-btn {
            transition: transform 0.2s ease-out;
          }

          .magnetic-btn:hover {
            transform: scale(1.02);
          }
        `,
        }}
      />

      {/* Particle Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute rounded-full bg-cyber-400"
            style={{
              left: particle.x,
              top: particle.y,
              width: particle.size,
              height: particle.size,
              opacity: particle.opacity,
            }}
            animate={{
              y: [0, -40, 0],
              x: [0, 30, 0],
              opacity: [
                particle.opacity,
                particle.opacity * 0.3,
                particle.opacity,
              ],
            }}
            transition={{
              duration: particle.duration,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Perspective Grid */}
      <motion.div
        className="absolute inset-0 z-0 pointer-events-none perspective-grid"
        style={{
          rotateX,
          rotateY,
          x: translateX,
          y: translateY,
          scale: 1.2,
        }}
      />

      {/* Left Column (Hero Section) */}
      <div className="hidden md:flex md:w-1/2 lg:w-3/5 p-12 lg:p-24 flex-col justify-between relative z-10 border-r border-white/5 bg-black/40 backdrop-blur-sm">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-cyber-900/40 via-transparent to-transparent pointer-events-none" />

        <motion.div
          style={{
            x: useTransform(springX, [-500, 500], [-30, 30]),
            y: useTransform(springY, [-500, 500], [-30, 30]),
          }}
          className="absolute top-1/4 -left-20 w-96 h-96 bg-cyber-500/20 rounded-full blur-[120px] pointer-events-none"
        />

        <div className="relative z-10">
          <Link href="/" className="flex items-center gap-3 mb-16 group w-fit">
            <motion.div
              className="w-8 h-8 bg-cyber-500 rounded flex items-center justify-center text-black font-bold text-xl shadow-[0_0_15px_rgba(6,182,212,0.5)]"
              whileHover={{ scale: 1.1, rotate: 5 }}
              transition={{ type: "spring", stiffness: 400 }}
            >
              M
            </motion.div>
            <span className="text-2xl font-bold tracking-tight text-white">
              <span className="text-cyber-400">Mock</span>Morph
            </span>
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            style={{
              x: useTransform(springX, [-500, 500], [-10, 10]),
              y: useTransform(springY, [-500, 500], [-10, 10]),
            }}
            className="max-w-xl"
          >
            <h1 className="text-5xl lg:text-6xl font-extrabold leading-[1.1] mb-8 tracking-tight">
              Production-grade data from{" "}
              <motion.span
                className="text-transparent bg-clip-text bg-gradient-to-r from-cyber-400 to-blue-500 inline-block"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
              >
                any schema.
              </motion.span>
            </h1>
            <motion.p
              className="text-xl text-zinc-400 leading-relaxed mb-12"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.6 }}
            >
              AI-powered intelligence that transforms sprawling SQL statements
              into relationally perfect datasets in seconds.
            </motion.p>

            <div className="flex flex-col gap-6">
              {[
                {
                  icon: Zap,
                  text: "Instant schema topology mapping",
                  color: "text-yellow-400",
                },
                {
                  icon: Database,
                  text: "Referential integrity guaranteed",
                  color: "text-emerald-400",
                },
                {
                  icon: Terminal,
                  text: "Developer-first terminal execution",
                  color: "text-blue-400",
                },
              ].map(({ icon: Icon, text, color }, index) => (
                <motion.div
                  key={text}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.8 + index * 0.1 }}
                  className="flex items-center gap-4 group cursor-pointer"
                  whileHover={{ x: 5 }}
                >
                  <motion.div
                    className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-cyber-500/20 group-hover:border-cyber-500/50 transition-colors"
                    whileHover={{ scale: 1.1, rotate: 5 }}
                  >
                    <Icon className={`w-4 h-4 ${color}`} />
                  </motion.div>
                  <span className="font-medium text-zinc-300 group-hover:text-white transition-colors">
                    {text}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="relative z-10"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <motion.div
                className="w-2 h-2 rounded-full bg-green-500"
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [1, 0.7, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              <p className="text-sm text-zinc-600 font-mono uppercase tracking-widest">
                SYS_STATUS: <span className="text-cyber-500">OPTIMAL</span>
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Right Column (Auth Card) */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 lg:p-24 bg-[#0a0a0a]/80 backdrop-blur-xl relative z-10">
        <motion.div
          className="md:hidden mb-12"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Link href="/" className="flex items-center gap-3 group">
            <motion.div
              className="w-8 h-8 bg-cyber-500 rounded flex items-center justify-center text-black font-bold text-xl shadow-[0_0_15px_rgba(6,182,212,0.5)]"
              whileHover={{ scale: 1.1, rotate: 5 }}
              transition={{ type: "spring", stiffness: 400 }}
            >
              M
            </motion.div>
            <span className="text-xl font-bold text-white">
              <span className="text-cyber-400">Mock</span>Morph
            </span>
          </Link>
        </motion.div>

        <motion.div
          ref={formRef}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          style={{
            rotateX: cardRotateX,
            rotateY: cardRotateY,
            transformStyle: "preserve-3d",
          }}
          className="w-full max-w-[420px] relative"
        >
          <div className="absolute -inset-4 bg-gradient-to-r from-cyber-500/20 to-blue-500/20 rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="relative bg-black/40 rounded-2xl p-10 border border-white/10 backdrop-blur-sm shadow-2xl">
            <div className="mb-8 text-center">
              <motion.h2
                className="text-3xl font-bold mb-3 tracking-tight"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.3 }}
              >
                {showEmailForm ? "Welcome back" : "Authenticate"}
              </motion.h2>
              <motion.p
                className="text-zinc-400 text-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.4 }}
              >
                {showEmailForm
                  ? "Sign in with your email and password"
                  : "Connect a provider to access the generation engine"}
              </motion.p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3"
              >
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-red-500"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
                {error}
              </motion.div>
            )}

            {!showEmailForm ? (
              <>
                <div className="flex flex-col gap-4 mb-6">
                  <motion.button
                    onClick={() => handleOAuth("github")}
                    disabled={oauthLoading !== null}
                    className="magnetic-btn bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 px-6 py-4 rounded-xl flex items-center justify-center gap-4 text-sm font-bold active:scale-95 disabled:opacity-50 transition-all group relative overflow-hidden w-full"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="absolute inset-0 shimmer opacity-0 group-hover:opacity-100" />
                    {oauthLoading === "github" ? (
                      <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                    ) : (
                      <FaGithub className="text-xl relative z-10" />
                    )}
                    <span className="relative z-10 text-base tracking-wide">Continue with GitHub</span>
                  </motion.button>

                  <motion.button
                    onClick={() => handleOAuth("google")}
                    disabled={oauthLoading !== null}
                    className="magnetic-btn bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 px-6 py-4 rounded-xl flex items-center justify-center gap-4 text-sm font-bold active:scale-95 disabled:opacity-50 transition-all group relative overflow-hidden w-full"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="absolute inset-0 shimmer opacity-0 group-hover:opacity-100" />
                    {oauthLoading === "google" ? (
                      <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                    ) : (
                      <FcGoogle className="text-xl relative z-10" />
                    )}
                    <span className="relative z-10 text-base tracking-wide">Continue with Google</span>
                  </motion.button>
                </div>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase tracking-widest font-mono">
                    <span className="bg-black/40 px-4 text-zinc-500">or</span>
                  </div>
                </div>

                <button
                  onClick={() => setShowEmailForm(true)}
                  className="w-full text-center text-sm text-zinc-400 hover:text-white transition-colors py-2"
                >
                  Sign in with email →
                </button>
              </>
            ) : (
              <form onSubmit={handleEmailLogin} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full pl-10 pr-4 py-3.5 rounded-xl bg-black/50 border border-white/10 focus:border-cyber-500/50 focus:outline-none transition-all text-sm placeholder:text-zinc-700"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full pl-10 pr-4 py-3.5 rounded-xl bg-black/50 border border-white/10 focus:border-cyber-500/50 focus:outline-none transition-all text-sm placeholder:text-zinc-700"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={emailLoading}
                  className="w-full bg-cyber-500 text-black py-3.5 rounded-xl font-bold text-sm hover:bg-cyber-400 transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                >
                  {emailLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Sign in"
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setShowEmailForm(false)}
                  className="w-full text-center text-xs text-zinc-500 hover:text-zinc-400 transition-colors mt-2"
                >
                  ← Back to OAuth
                </button>
              </form>
            )}

            <motion.div
              className="mt-8 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.7 }}
            >
              <p className="text-xs text-zinc-500">
                By continuing, you agree to the{" "}
                <Link href="#" className="text-zinc-400 hover:text-white transition-colors underline decoration-white/20 underline-offset-2">
                  Terms of Service
                </Link>
              </p>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}