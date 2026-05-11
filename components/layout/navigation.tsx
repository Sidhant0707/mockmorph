"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
} from "framer-motion";
import { FaGithub } from "react-icons/fa6";
import {
  HiOutlineBars3,
  HiOutlineXMark,
  HiArrowRightOnRectangle,
  HiOutlineRectangleStack,
  HiSparkles,
  HiCheckBadge,
} from "react-icons/hi2";
import { MockMorphLogo } from "@/components/ui/logo";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("");

  const { data: session, status } = useSession();
  const { scrollY } = useScroll();

  const profileRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Parallax effect for nav background
  const navOpacity = useTransform(scrollY, [0, 100], [0, 1]);
  const navBlur = useTransform(scrollY, [0, 100], [0, 20]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      setIsScrolled(scrollPosition > 20);

      // Active section detection
      const sections = ["features", "terminal", "docs"];
      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const { top, bottom } = element.getBoundingClientRect();
          if (top <= 100 && bottom >= 100) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setIsProfileOpen(false);
      }
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setIsMobileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProfileOpen(false);
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    // Prevent body scroll when mobile menu is open
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isMobileMenuOpen]);

  const scrollToSection = (href: string) => {
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      {/* Premium glass navigation */}
      <motion.nav
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-700 ${
          isScrolled
            ? "bg-earth-900/70 backdrop-blur-2xl border-b border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
            : "bg-transparent"
        }`}
        style={{
          backdropFilter: isScrolled ? `blur(${navBlur}px)` : "none",
        }}
      >
        {/* Subtle top gradient accent */}
        {isScrolled && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-400/30 to-transparent"
          />
        )}

        <div className="max-w-7xl mx-auto px-6 sm:px-8">
          <div className="h-[4.5rem] flex items-center justify-between relative">
            {/* Enhanced Logo */}
            <motion.div
              className="flex items-center gap-3 cursor-pointer group relative"
              whileHover={{ scale: 1.03 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              {/* Glow effect on hover */}
              <motion.div
                className="absolute inset-0 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background:
                    "radial-gradient(circle, rgba(96, 165, 250, 0.15) 0%, transparent 70%)",
                }}
              />

              <div className="relative">
                <MockMorphLogo className="w-10 h-10 drop-shadow-[0_0_16px_rgba(96,165,250,0.3)] transition-all duration-300 group-hover:drop-shadow-[0_0_24px_rgba(96,165,250,0.5)]" />
              </div>

              <div className="relative">
                <span className="text-[1.35rem] font-bold tracking-tight flex items-center gap-0.5">
                  <span className="text-cyber-400 group-hover:text-cyber-300 transition-all duration-300 relative">
                    Mock
                    <motion.span
                      className="absolute -inset-1 bg-cyber-400/10 blur-lg rounded opacity-0 group-hover:opacity-100"
                      transition={{ duration: 0.3 }}
                    />
                  </span>
                  <span className="text-white group-hover:text-white/95 transition-colors duration-300">
                    Morph
                  </span>
                </span>
              </div>
            </motion.div>

            {/* Premium Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1 bg-white/[0.03] rounded-full px-2 py-2 border border-white/[0.06] backdrop-blur-xl">
              <NavLink
                href="#terminal"
                isActive={activeSection === "terminal"}
                onClick={() => scrollToSection("#terminal")}
              >
                Terminal
              </NavLink>
              <NavLink
                href="#docs"
                isActive={activeSection === "docs"}
                onClick={() => scrollToSection("#docs")}
              >
                API Docs
              </NavLink>
              <NavLink
                href="#features"
                isActive={activeSection === "features"}
                onClick={() => scrollToSection("#features")}
              >
                Features
              </NavLink>
              <NavLink
                href="#pricing"
                isActive={activeSection === "pricing"}
                onClick={() => scrollToSection("#pricing")}
              >
                Pricing
              </NavLink>
            </div>

            {/* Enhanced CTA Section */}
            <div className="hidden md:flex items-center gap-3">
              <motion.a
                href="https://github.com/sidhant0707"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden lg:inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium text-earth-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 cursor-pointer group backdrop-blur-sm"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.98 }}
                transition={{ duration: 0.2 }}
              >
                <FaGithub className="text-lg group-hover:rotate-12 transition-transform duration-300" />
                <span className="font-semibold">GitHub</span>
              </motion.a>

              {status === "loading" ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-earth-800 to-earth-900 animate-pulse border border-white/[0.06]" />
                </div>
              ) : session ? (
                <>
                  <div className="w-px h-8 bg-gradient-to-b from-transparent via-white/[0.12] to-transparent mx-1" />

                  {/* Premium Profile Menu */}
                  <div className="relative" ref={profileRef}>
                    <motion.button
                      onClick={() => setIsProfileOpen(!isProfileOpen)}
                      title="Profile menu"
                      className="relative flex items-center gap-3 pl-3 pr-1 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] transition-all duration-300 cursor-pointer group"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {/* User name with verified badge */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-earth-200 group-hover:text-white transition-colors max-w-[120px] truncate">
                          {session.user?.name?.split(" ")[0]}
                        </span>
                        <HiCheckBadge className="text-cyber-400 text-base flex-shrink-0" />
                      </div>

                      <div className="relative">
                        <Image
                          src={
                            session.user?.image ||
                            "https://api.dicebear.com/7.x/avataaars/svg?seed=fallback"
                          }
                          alt="Profile"
                          width={36}
                          height={36}
                          className="w-9 h-9 rounded-full object-cover border-2 border-white/[0.12] shadow-lg bg-earth-900"
                        />
                        {/* Online indicator */}
                        <motion.div
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-earth-900"
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                        />
                      </div>
                    </motion.button>

                    {/* Premium Dropdown */}
                    <AnimatePresence>
                      {isProfileOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.96 }}
                          transition={{
                            duration: 0.2,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="absolute right-0 mt-3 w-64 rounded-2xl border border-white/[0.08] bg-earth-900/95 backdrop-blur-2xl shadow-[0_24px_48px_rgba(0,0,0,0.6)] overflow-hidden origin-top-right"
                        >
                          {/* Gradient accent */}
                          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-400/40 to-transparent" />

                          {/* User Info Header */}
                          <div className="px-4 py-4 bg-gradient-to-b from-white/[0.06] to-transparent border-b border-white/[0.08]">
                            <div className="flex items-start gap-3">
                              <Image
                                src={
                                  session.user?.image ||
                                  "https://api.dicebear.com/7.x/avataaars/svg?seed=fallback"
                                }
                                alt="Profile"
                                width={44}
                                height={44}
                                className="w-11 h-11 rounded-xl object-cover border border-white/[0.12] shadow-lg bg-earth-900"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                                  {session.user?.name}
                                  <HiCheckBadge className="text-cyber-400 text-sm flex-shrink-0" />
                                </p>
                                <p className="text-xs text-earth-400 truncate mt-0.5">
                                  {session.user?.email}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Menu Items */}
                          <div className="py-2">
                            <Link
                              href="/dashboard"
                              onClick={() => setIsProfileOpen(false)}
                              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-earth-300 hover:text-white hover:bg-white/[0.06] transition-all duration-200 cursor-pointer group"
                            >
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] group-hover:bg-white/[0.08] border border-white/[0.06] transition-all duration-200">
                                <HiOutlineRectangleStack className="text-base" />
                              </div>
                              <div className="flex-1">
                                <div className="font-medium">Dashboard</div>
                                <div className="text-xs text-earth-500 group-hover:text-earth-400 transition-colors">
                                  Manage your APIs
                                </div>
                              </div>
                            </Link>
                          </div>

                          {/* Sign Out */}
                          <div className="py-2 border-t border-white/[0.08] bg-white/[0.02]">
                            <button
                              onClick={() => signOut()}
                              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all duration-200 cursor-pointer group"
                            >
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/5 group-hover:bg-red-500/15 border border-red-500/20 transition-all duration-200">
                                <HiArrowRightOnRectangle className="text-base" />
                              </div>
                              <span className="font-medium">Sign out</span>
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <Link href="/login">
                  <motion.button
                    className="relative px-6 py-2.5 rounded-xl text-sm font-semibold bg-earth-900/40 border border-white/10 text-earth-200 hover:bg-white/10 hover:text-white hover:border-cyber-500/50 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-[0_0_20px_rgba(96,165,250,0.2)] overflow-hidden group backdrop-blur-xl"
                    whileHover={{ scale: 1.03, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {/* Shimmer effect */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                      animate={{
                        x: ["-100%", "200%"],
                      }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                    />
                    <span className="relative flex items-center gap-2">
                      Sign In
                    </span>
                  </motion.button>
                </Link>
              )}
            </div>

            {/* Enhanced Mobile Controls */}
            <div
              className="md:hidden flex items-center gap-3"
              ref={mobileMenuRef}
            >
              {status === "loading" ? (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-earth-800 to-earth-900 animate-pulse border border-white/[0.06]" />
              ) : session ? (
                <motion.button
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  aria-label="Open profile menu"
                  title="Open profile menu"
                  className="relative focus:outline-none cursor-pointer"
                  whileTap={{ scale: 0.95 }}
                >
                  <Image
                    src={
                      session.user?.image ||
                      "https://api.dicebear.com/7.x/avataaars/svg?seed=fallback"
                    }
                    alt="Profile"
                    width={36}
                    height={36}
                    className="w-9 h-9 rounded-full object-cover border-2 border-white/[0.12] shadow-lg bg-earth-900"
                  />
                  {/* Online indicator */}
                  <motion.div
                    className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-earth-900"
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                </motion.button>
              ) : (
                <Link
                  href="/login"
                  className="text-sm font-semibold text-earth-300 hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-white/[0.05]"
                >
                  Sign In
                </Link>
              )}

              {/* Premium Hamburger Button */}
              <motion.button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={
                  isMobileMenuOpen ? "Close mobile menu" : "Open mobile menu"
                }
                title={
                  isMobileMenuOpen ? "Close mobile menu" : "Open mobile menu"
                }
                className="relative w-10 h-10 flex items-center justify-center text-earth-300 hover:text-white focus:outline-none rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 cursor-pointer"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <AnimatePresence mode="wait">
                  {isMobileMenuOpen ? (
                    <motion.div
                      key="close"
                      initial={{ rotate: -90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      exit={{ rotate: 90, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <HiOutlineXMark className="text-2xl" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="menu"
                      initial={{ rotate: 90, opacity: 0 }}
                      animate={{ rotate: 0, opacity: 1 }}
                      exit={{ rotate: -90, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <HiOutlineBars3 className="text-2xl" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>

              {/* Mobile Profile Dropdown */}
              <AnimatePresence>
                {isProfileOpen && session && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{
                      duration: 0.2,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="absolute top-20 right-6 w-64 rounded-2xl border border-white/[0.08] bg-earth-900/95 backdrop-blur-2xl shadow-[0_24px_48px_rgba(0,0,0,0.6)] overflow-hidden origin-top-right"
                  >
                    {/* Gradient accent */}
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-400/40 to-transparent" />

                    {/* User Info Header */}
                    <div className="px-4 py-4 bg-gradient-to-b from-white/[0.06] to-transparent border-b border-white/[0.08]">
                      <div className="flex items-start gap-3">
                        <Image
                          src={
                            session.user?.image ||
                            "https://api.dicebear.com/7.x/avataaars/svg?seed=fallback"
                          }
                          alt="Profile"
                          width={44}
                          height={44}
                          className="w-11 h-11 rounded-xl object-cover border border-white/[0.12] shadow-lg bg-earth-900"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                            {session.user?.name}
                            <HiCheckBadge className="text-cyber-400 text-sm flex-shrink-0" />
                          </p>
                          <p className="text-xs text-earth-400 truncate mt-0.5">
                            {session.user?.email}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Menu Items */}
                    <div className="py-2">
                      <Link
                        href="/dashboard"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-sm text-earth-300 hover:text-white hover:bg-white/[0.06] transition-all duration-200 cursor-pointer group"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] group-hover:bg-white/[0.08] border border-white/[0.06] transition-all duration-200">
                          <HiOutlineRectangleStack className="text-base" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">Dashboard</div>
                          <div className="text-xs text-earth-500 group-hover:text-earth-400 transition-colors">
                            Manage your APIs
                          </div>
                        </div>
                      </Link>
                    </div>

                    {/* Sign Out */}
                    <div className="py-2 border-t border-white/[0.08] bg-white/[0.02]">
                      <button
                        onClick={() => signOut()}
                        className="flex w-full items-center gap-3 px-4 py-3 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all duration-200 cursor-pointer group"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/5 group-hover:bg-red-500/15 border border-red-500/20 transition-all duration-200">
                          <HiArrowRightOnRectangle className="text-base" />
                        </div>
                        <span className="font-medium">Sign out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Premium Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />

            {/* Menu Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="fixed top-[4.5rem] right-0 bottom-0 w-[280px] bg-earth-900/95 backdrop-blur-2xl border-l border-white/[0.08] shadow-[-24px_0_48px_rgba(0,0,0,0.6)] z-40 md:hidden overflow-y-auto"
            >
              {/* Gradient accent */}
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-400/40 to-transparent" />

              <div className="p-6 space-y-2">
                {/* Navigation Links */}
                <MobileNavLink
                  href="#features"
                  onClick={() => scrollToSection("#features")}
                  isActive={activeSection === "features"}
                >
                  Features
                </MobileNavLink>
                <MobileNavLink
                  href="#terminal"
                  onClick={() => scrollToSection("#terminal")}
                  isActive={activeSection === "terminal"}
                >
                  Terminal
                </MobileNavLink>
                <MobileNavLink
                  href="#docs"
                  onClick={() => scrollToSection("#docs")}
                  isActive={activeSection === "docs"}
                >
                  API Docs
                </MobileNavLink>

                {/* Divider */}
                <div className="py-3">
                  <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                </div>

                {/* GitHub Link */}
                <motion.a
                  href="https://github.com/sidhant0707"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-earth-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 cursor-pointer group"
                  whileTap={{ scale: 0.98 }}
                >
                  <FaGithub className="text-lg group-hover:rotate-12 transition-transform duration-300" />
                  <span>Star on GitHub</span>
                </motion.a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// Premium Desktop NavLink Component
const NavLink = ({
  href,
  children,
  isActive,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) => (
  <motion.a
    href={href}
    onClick={(e) => {
      e.preventDefault();
      onClick();
    }}
    className={`relative px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all duration-300 ${
      isActive
        ? "text-white bg-white/[0.12] shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
        : "text-earth-300 hover:text-white hover:bg-white/[0.06]"
    }`}
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
  >
    {isActive && (
      <motion.div
        layoutId="activeSection"
        className="absolute inset-0 bg-gradient-to-r from-cyber-500/20 via-cyber-400/10 to-cyber-500/20 rounded-lg"
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      />
    )}
    <span className="relative">{children}</span>
  </motion.a>
);

// Premium Mobile NavLink Component
const MobileNavLink = ({
  href,
  children,
  isActive,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) => (
  <motion.a
    href={href}
    onClick={(e) => {
      e.preventDefault();
      onClick();
    }}
    className={`relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-300 ${
      isActive
        ? "text-white bg-gradient-to-r from-cyber-500/20 via-cyber-400/10 to-cyber-500/20 border border-cyber-400/30"
        : "text-earth-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12]"
    }`}
    whileTap={{ scale: 0.98 }}
  >
    {isActive && (
      <motion.div
        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-cyber-400 to-cyber-500 rounded-r-full"
        layoutId="activeMobileSection"
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      />
    )}
    <span className={isActive ? "ml-2" : ""}>{children}</span>
  </motion.a>
);
