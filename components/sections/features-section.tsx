'use client';

import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { HiOutlineSparkles, HiOutlineBolt, HiOutlineShieldCheck } from 'react-icons/hi2';
import { IconHover3D } from '@/components/ui/icon-hover-3d';

const features = [
  {
    heading: "AI Pattern Discovery",
    text: "Gemini 2.5 Flash analyzes your schema relationships, not just column types. It understands semantic patterns — names look like names, emails are properly formatted, and amounts fall within realistic ranges.",
    icon: <HiOutlineSparkles className="text-3xl" />
  },
  {
    heading: "O(1) Edge Streaming",
    text: "Bypasses Vercel timeouts and memory limits by yielding data chunk-by-chunk directly to your terminal. Each row is flushed the moment it's generated — no buffering, no waiting.",
    icon: <HiOutlineBolt className="text-3xl" />
  },
  {
    heading: "Relational Enforcer",
    text: "Kahn's Algorithm topologically sorts your dependency graph to handle complex foreign keys and circular references. Every row is valid on INSERT — guaranteed.",
    icon: <HiOutlineShieldCheck className="text-3xl" />
  }
];

export default function FeaturesSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="features" className="relative py-20 sm:py-32 overflow-hidden">
      <div ref={ref} className="max-w-7xl mx-auto px-6 sm:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16 sm:mb-20"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel mb-6 border border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-cyber-400"></span>
            <span className="text-[10px] sm:text-xs text-cyber-400 tracking-wide font-medium uppercase">Architecture</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">Engineered for production</h2>
          <p className="text-cyber-400 text-base sm:text-lg max-w-2xl mx-auto font-light">Three pillars that make MockMorph the definitive choice for enterprise mock data generation.</p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 max-w-4xl mx-auto">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: index * 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full"
            >
              <IconHover3D 
                heading={feature.heading} 
                text={feature.text} 
                icon={feature.icon}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}