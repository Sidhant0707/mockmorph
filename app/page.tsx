import Navigation from "@/components/layout/navigation";
import HeroSection from "@/components/sections/hero-section";
import TerminalSection from "@/components/sections/terminal-section";
import FeaturesSection from "@/components/sections/features-section";
import Footer from "@/components/layout/footer";
import CyberBackground from "@/components/ui/cyber-background";
import PricingSection from "@/components/pricing";
import DocsSection from "@/components/docs-section";

export default function MockMorphLanding() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-cyber-100 font-sans relative overflow-x-hidden">
      <CyberBackground />

      <div className="relative z-10">
        <Navigation />
        <HeroSection />

        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent max-w-4xl mx-auto w-full" />
        <TerminalSection />

        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent max-w-4xl mx-auto w-full" />
        <DocsSection />

        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent max-w-4xl mx-auto w-full" />
        <FeaturesSection />

        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent max-w-4xl mx-auto w-full" />
        <PricingSection />

        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent max-w-4xl mx-auto w-full" />
        <Footer />
      </div>
    </div>
  );
}
