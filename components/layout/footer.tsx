// components/layout/footer.tsx
import React from "react";
import { HiOutlineCircleStack } from "react-icons/hi2";
import { FaXTwitter, FaGithub, FaLinkedin } from "react-icons/fa6";

export default function Footer() {
  return (
    <footer className="border-t border-earth-700/20 py-16">
      <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-earth-400 to-earth-600 flex items-center justify-center">
            <HiOutlineCircleStack className="text-earth-950 text-sm" />
          </div>
          <span className="text-earth-500 text-sm font-light">
            © {new Date().getFullYear()} Sidhant Kumar. Built for the modern
            enterprise.
          </span>
        </div>

        <div className="flex gap-4">
          <a
            href="https://x.com/SiDHANT0707"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X profile"
            title="X profile"
            className="w-10 h-10 rounded-lg bg-earth-900/70 flex items-center justify-center text-earth-500 hover:text-earth-300 hover:bg-earth-800 border border-earth-700/20 transition-all"
          >
            <FaXTwitter className="text-lg" />
          </a>
          <a
            href="https://github.com/sidhant0707"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub profile"
            title="GitHub profile"
            className="w-10 h-10 rounded-lg bg-earth-900/70 flex items-center justify-center text-earth-500 hover:text-earth-300 hover:bg-earth-800 border border-earth-700/20 transition-all"
          >
            <FaGithub className="text-lg" />
          </a>
          <a
            href="https://www.linkedin.com/in/sidhant07"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn profile"
            title="LinkedIn profile"
            className="w-10 h-10 rounded-lg bg-earth-900/70 flex items-center justify-center text-earth-500 hover:text-earth-300 hover:bg-earth-800 border border-earth-700/20 transition-all"
          >
            <FaLinkedin className="text-lg" />
          </a>
        </div>
      </div>
    </footer>
  );
}
