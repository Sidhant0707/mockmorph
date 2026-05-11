'use client';

import React, { useRef, useEffect, useState } from 'react';
import { motion, useInView, useSpring, useTransform } from 'framer-motion';

const stats = [
  { value: 10000000, suffix: "+", label: "Rows Generated", format: "millions" },
  { value: 99.9, suffix: "%", label: "Uptime SLA", format: "decimal" },
  { value: 50, suffix: "ms", label: "Avg Response", prefix: "<", format: "number" },
  { value: 500, suffix: "+", label: "Enterprise Teams", format: "number" }
];

function AnimatedCounter({ value, format, prefix = "", suffix = "" }: { value: number; format: string; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const [displayValue, setDisplayValue] = useState(0);
  
  const springValue = useSpring(0, { damping: 50, stiffness: 100 });

  useEffect(() => {
    if (isInView) {
      springValue.set(value);
    }
  }, [isInView, value, springValue]);

  useEffect(() => {
    return springValue.on("change", (latest) => {
      setDisplayValue(latest);
    });
  }, [springValue]);

  const formatValue = (val: number) => {
    if (format === "millions") {
      return `${(val / 1000000).toFixed(1)}M`;
    } else if (format === "decimal") {
      return val.toFixed(1);
    } else {
      return Math.floor(val).toString();
    }
  };

  return (
    <div ref={ref} className="text-4xl font-light text-earth-400 mb-2">
      {prefix}{formatValue(displayValue)}{suffix}
    </div>
  );
}

export default function StatsSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-24">
      <div ref={ref} className="max-w-7xl mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 1 }}
          className="relative bg-earth-900/70 backdrop-blur-xl rounded-2xl p-12 border border-earth-700/20 shadow-2xl shadow-earth-950/50 overflow-hidden"
          whileHover={{ scale: 1.02 }}
        >
          {/* Animated gradient background */}
          <motion.div 
            className="absolute inset-0 bg-gradient-to-br from-cyber-500/5 via-transparent to-purple-500/5 opacity-0"
            animate={{ opacity: [0, 0.3, 0] }}
            transition={{ duration: 4, repeat: Infinity }}
          />
          
          {/* Grid overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:30px_30px] pointer-events-none" />
          
          <motion.div
            initial="initial"
            animate={isInView ? "animate" : "initial"}
            variants={{ animate: { transition: { staggerChildren: 0.1 } } }}
            className="grid md:grid-cols-4 gap-8 text-center relative z-10"
          >
            {stats.map((stat, index) => (
              <motion.div
                key={index}
                variants={{
                  initial: { opacity: 0, y: 20 },
                  animate: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } }
                }}
                className="group cursor-default"
              >
                <AnimatedCounter 
                  value={stat.value} 
                  format={stat.format}
                  prefix={stat.prefix}
                  suffix={stat.suffix}
                />
                <motion.div 
                  className="text-earth-500 text-sm font-light"
                  whileHover={{ color: "#06b6d4" }}
                >
                  {stat.label}
                </motion.div>
                
                {/* Decorative underline on hover */}
                <motion.div 
                  className="h-0.5 bg-gradient-to-r from-transparent via-cyber-400 to-transparent mt-4 opacity-0 group-hover:opacity-100 transition-opacity"
                  initial={{ scaleX: 0 }}
                  whileHover={{ scaleX: 1 }}
                  transition={{ duration: 0.3 }}
                />
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}