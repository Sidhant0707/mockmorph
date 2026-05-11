"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { HiCheck, HiSparkles } from "react-icons/hi2";
import { HiLockClosed } from "react-icons/hi";
import Link from "next/link";
import { useRef } from "react";

const EXPO_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: EXPO_OUT },
  },
};

const pricingPlans = [
  {
    name: "Architect",
    price: "$0",
    period: "/forever",
    description: "Perfect for testing schemas and prototyping local builds.",
    features: [
      "50 rows per generation",
      "Standard data types",
      "10 generations per day",
      "Raw SQL output",
    ],
    cta: "Current Plan",
    isPrimary: true,
    status: "active",
  },
  {
    name: "Data Weaver",
    price: "$15",
    period: "/mo",
    description: "Production-grade mock data for serious engineering teams.",
    features: [
      "10,000 rows per generation",
      "Semantic AI data matching",
      "Unlimited daily generations",
      "Export to CSV, JSON, & SQL",
      "Save to Dashboard",
    ],
    cta: "Locked",
    isPrimary: false,
    status: "coming-soon",
    badge: "Coming Soon",
  },
  {
    name: "Syndicate",
    price: "Custom",
    period: "",
    description: "Infinite scale infrastructure for enterprise ecosystems.",
    features: [
      "Unlimited row generation",
      "Custom LLM fine-tuning",
      "Team collaboration & SSO",
      "Dedicated VPC deployment",
      "Priority SLA support",
    ],
    cta: "Join Waitlist",
    isPrimary: false,
    status: "coming-soon",
    badge: "Coming Soon",
  },
];

function PricingCard({ plan, index }: { plan: typeof pricingPlans[0]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  
  const mouseXSpring = useSpring(x);
  const mouseYSpring = useSpring(y);
  
  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["7.5deg", "-7.5deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-7.5deg", "7.5deg"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      variants={fadeUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY }}
      className={`relative flex flex-col p-8 rounded-3xl backdrop-blur-xl transition-all duration-500 ${
        plan.isPrimary
          ? "bg-earth-900/40 border border-cyber-500/30 shadow-[0_0_40px_rgba(96,165,250,0.1)]"
          : "bg-white/[0.02] border border-white/[0.08]"
      } ${plan.status === "coming-soon" ? "opacity-60 grayscale-[0.5]" : ""} [transform-style:preserve-3d]`}
    >
      {plan.badge && (
        <motion.div 
          className="absolute -top-4 left-1/2 -translate-x-1/2 bg-earth-900 border border-white/10 text-earth-300 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-xl [transform:translateZ(20px)]"
          animate={{ y: [0, -2, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: index * 0.2 }}
        >
          {plan.badge}
        </motion.div>
      )}

      {plan.isPrimary && (
        <>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-cyber-400 to-transparent opacity-50" />
          <motion.div
            className="absolute -inset-1 bg-gradient-to-br from-cyber-500/20 to-transparent rounded-3xl blur-xl opacity-0"
            whileHover={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          />
        </>
      )}

      <div className="mb-8 [transform:translateZ(20px)]">
        <h3 className="text-xl font-bold mb-3 text-white tracking-tight">
          {plan.name}
        </h3>
        <p className="text-sm text-earth-400 h-10 mb-6 leading-relaxed">
          {plan.description}
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-bold text-white tracking-tight">
            {plan.price}
          </span>
          {plan.period && (
            <span className="text-earth-500 font-medium tracking-wide">
              {plan.period}
            </span>
          )}
        </div>
      </div>

      <ul className="space-y-4 mb-10 flex-1 [transform:translateZ(15px)]">
        {plan.features.map((feature, fidx) => (
          <li key={fidx}>
            <motion.div 
              className="flex gap-3 text-sm text-earth-300"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: fidx * 0.1 }}
            >
              <div className="mt-0.5 flex-shrink-0">
                {plan.status === "coming-soon" ? (
                  <HiLockClosed className="w-5 h-5 text-earth-600" />
                ) : (
                  <HiCheck className="w-5 h-5 text-cyber-400" />
                )}
              </div>
              <span>{feature}</span>
            </motion.div>
          </li>
        ))}
      </ul>

      <div className="mt-auto [transform:translateZ(25px)]">
        {plan.status === "active" ? (
          <Link
            href="/dashboard"
            className="flex w-full justify-center items-center py-3.5 rounded-xl font-semibold text-sm transition-all duration-300 bg-white/[0.05] hover:bg-white/[0.1] text-white border border-white/10 hover:scale-105"
          >
            {plan.cta}
          </Link>
        ) : (
          <button
            disabled
            className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all border border-white/[0.05] bg-transparent text-earth-500 cursor-not-allowed flex items-center justify-center gap-2"
          >
            <HiLockClosed className="w-4 h-4" />
            {plan.cta}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default function PricingSection() {
  return (
    <section id="pricing" className="py-32 relative">
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-10%" }}
        variants={staggerContainer}
        className="max-w-7xl mx-auto px-6 sm:px-8 relative z-10"
      >
        <motion.div variants={fadeUp} className="text-center mb-20">
          <motion.div 
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/10 text-earth-300 text-xs font-bold mb-6 uppercase tracking-widest hover:border-cyber-400/30 transition-all"
            whileHover={{ scale: 1.05 }}
          >
            {/* <HiSparkles className="w-4 h-4 text-cyber-400" /> */}
            Infrastructure Scaling
          </motion.div>
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-white tracking-tight">
            Predictable compute pricing.
          </h2>
          <p className="text-earth-400 max-w-2xl mx-auto text-lg">
            Start synthesizing data immediately. Upgrade when your architecture
            demands massive scale.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 [perspective:1000px]">
          {pricingPlans.map((plan, idx) => (
            <PricingCard key={idx} plan={plan} index={idx} />
          ))}
        </div>
      </motion.div>
    </section>
  );
}