'use client';

import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { HiOutlineSparkles, HiOutlineBolt, HiOutlineShieldCheck } from 'react-icons/hi2';
import { IconHover3D } from '@/components/ui/icon-hover-3d';

const features = [
  {
    heading: "AI Semantic Classification",
    text: "A Groq-hosted model reads your schema and classifies each column — email, price, name, and eight other semantic types — so generated values pick the right kind of fake data instead of a generic placeholder.",
    icon: <HiOutlineSparkles className="text-3xl" />
  },
  {
    heading: "Real-Time Streaming",
    text: "Rows are yielded chunk-by-chunk to your terminal via the Web Streams API the moment each one is generated — no buffering the full result before you see anything, and a disconnect stops work server-side immediately.",
    icon: <HiOutlineBolt className="text-3xl" />
  },
  {
    heading: "Locally Verified Dependency Order",
    text: "Table and foreign-key relationships are parsed from your SQL and topologically sorted with Kahn's algorithm — run locally, not left to the AI's judgment. A cycle or a foreign key with no matching table is rejected before any row is generated, and every foreign key value is drawn from that specific parent table's actually-generated primary keys.",
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
          <p className="text-cyber-400 text-base sm:text-lg max-w-2xl mx-auto font-light">Three pillars behind how MockMorph turns a SQL schema into relationally-consistent mock data.</p>
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