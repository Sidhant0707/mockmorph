"use client";

import React, { useState, useRef, useId, useMemo, useContext } from "react";
import {
  motion,
  MotionConfigContext,
  LayoutGroup,
  Transition as FramerTransition,
} from "framer-motion";

interface Props {
  heading: string;
  text: string;
  icon?: React.ReactNode;
  width?: number | string;
  height?: number | string;
  className?: string;
}

const transition1: FramerTransition = {
  bounce: 0,
  delay: 0,
  duration: 0.4,
  type: "spring",
};
const transition2: FramerTransition = {
  delay: 0,
  duration: 0.5,
  ease: [0.25, 1, 0.5, 1],
  type: "tween",
};
const titleTransition: FramerTransition = {
  duration: 0.3,
  ease: [0.25, 0.46, 0.45, 0.94],
  type: "tween",
};

const Transition: React.FC<{
  value: FramerTransition | undefined;
  children: React.ReactNode;
}> = ({ value, children }) => {
  const config = useContext(MotionConfigContext);
  const transition = value ?? config.transition;
  const contextValue = useMemo(
    () => ({ ...config, transition }),
    [config, transition],
  );
  return (
    <MotionConfigContext.Provider value={contextValue}>
      {children}
    </MotionConfigContext.Provider>
  );
};

const Variants = motion.create(React.Fragment);

export const IconHover3D: React.FC<Props> = ({
  heading,
  text,
  icon,
  width = "100%",
  height = "auto",
  className = "",
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const refBinding = useRef<HTMLDivElement>(null);
  const defaultLayoutId = useId();

  const layerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 10, 10, 0.8)",
    backdropFilter: "blur(4px)",
    transformStyle: "preserve-3d",
  };

  return (
    <div style={{ width, height }} className="relative h-full">
      <LayoutGroup id={defaultLayoutId}>
        <Variants animate={isHovered ? ["hover"] : ["default"]} initial={false}>
          <Transition value={transition1}>
            <motion.div
              className={`relative glass-panel rounded-2xl p-8 flex flex-col md:flex-row items-center gap-10 cursor-default h-full w-full overflow-hidden ${className}`}
              ref={refBinding}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              whileHover={{
                y: -5,
                boxShadow:
                  "0 20px 60px -15px rgba(0,0,0,0.5), 0 0 40px rgba(255,255,255,0.02)",
              }}
            >
              <div className="relative w-32 h-32 flex-shrink-0 flex items-center justify-center rounded-xl border border-white/5 bg-white/[0.02] overflow-visible">
                <div className="absolute inset-0 flex items-center justify-center perspective-[1200px]">
                  <motion.div
                    style={{
                      width: "70px",
                      height: "70px",
                      transformStyle: "preserve-3d",
                    }}
                    animate={
                      isHovered
                        ? { rotateX: 65, rotateZ: 45, scale: 1.1 }
                        : { rotateX: 60, rotateZ: 45, scale: 0.9 }
                    }
                    transition={transition2}
                  >
                    <Transition value={transition2}>
                      <motion.div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-cyber-200 shadow-[0_0_20px_4px_rgba(255,255,255,0.8)]"
                        animate={
                          isHovered
                            ? { height: "120px", opacity: 0.8 }
                            : { height: "0px", opacity: 0 }
                        }
                        style={{ rotateX: 90, rotateY: -45 }}
                      />

                      <motion.div
                        style={{
                          ...layerStyle,
                          border: "2px solid rgba(59, 130, 246, 0.8)",
                          boxShadow: isHovered
                            ? "0 0 20px rgba(59, 130, 246, 0.4) inset, 0 0 20px rgba(59, 130, 246, 0.4)"
                            : "none",
                        }}
                        animate={isHovered ? { z: -40 } : { z: -8 }}
                      >
                        <div
                          className="w-full h-full border border-blue-500/30 rounded-xl m-1"
                          style={{
                            backgroundImage:
                              "radial-gradient(rgba(59,130,246,0.4) 1px, transparent 1px)",
                            backgroundSize: "8px 8px",
                          }}
                        />
                      </motion.div>

                      <motion.div
                        style={{
                          ...layerStyle,
                          border: "2px solid rgba(148, 163, 184, 0.5)",
                        }}
                        animate={{ z: 0 }}
                      />

                      <motion.div
                        style={{
                          ...layerStyle,
                          border: "2px solid rgba(168, 85, 247, 0.8)",
                          boxShadow: isHovered
                            ? "0 0 20px rgba(168, 85, 247, 0.4) inset, 0 0 20px rgba(168, 85, 247, 0.4)"
                            : "none",
                        }}
                        animate={isHovered ? { z: 40 } : { z: 8 }}
                      >
                        <div
                          className="w-full h-full border border-purple-500/30 rounded-xl m-1"
                          style={{
                            backgroundImage:
                              "radial-gradient(rgba(168,85,247,0.4) 1px, transparent 1px)",
                            backgroundSize: "8px 8px",
                          }}
                        />
                        <motion.div
                          className="absolute text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                          animate={
                            isHovered
                              ? {
                                  rotateZ: -45,
                                  rotateX: -65,
                                  scale: 1.2,
                                  y: -20,
                                }
                              : { rotateZ: -45, rotateX: -60, scale: 1, y: 0 }
                          }
                          transition={transition2}
                        >
                          {icon}
                        </motion.div>
                      </motion.div>
                    </Transition>
                  </motion.div>
                </div>

                <motion.div
                  className="absolute top-2 left-2 w-2 h-2 border-t border-l border-cyber-500"
                  animate={
                    isHovered
                      ? { scale: 1.5, opacity: 1 }
                      : { scale: 1, opacity: 0.3 }
                  }
                />
                <motion.div
                  className="absolute bottom-2 left-2 w-2 h-2 border-b border-l border-cyber-500"
                  animate={
                    isHovered
                      ? { scale: 1.5, opacity: 1 }
                      : { scale: 1, opacity: 0.3 }
                  }
                />
                <motion.div
                  className="absolute bottom-2 right-2 w-2 h-2 border-b border-r border-cyber-500"
                  animate={
                    isHovered
                      ? { scale: 1.5, opacity: 1 }
                      : { scale: 1, opacity: 0.3 }
                  }
                />
                <motion.div
                  className="absolute top-2 right-2 w-2 h-2 border-t border-r border-cyber-500"
                  animate={
                    isHovered
                      ? { scale: 1.5, opacity: 1 }
                      : { scale: 1, opacity: 0.3 }
                  }
                />
              </div>

              <div className="flex flex-col gap-3 w-full">
                <div className="relative flex items-center overflow-hidden h-8">
                  <span className="font-semibold text-lg text-cyber-50 absolute z-0">
                    {heading}
                  </span>
                  <motion.div
                    className="absolute top-0 left-0 w-full h-full bg-white origin-left z-10"
                    animate={{ scaleX: isHovered ? 1 : 0 }}
                    transition={titleTransition}
                  />
                  <motion.span
                    className="font-semibold text-lg text-cyber-950 absolute z-20"
                    animate={{
                      clipPath: `inset(0 ${isHovered ? "0%" : "100%"} 0 0)`,
                    }}
                    transition={titleTransition}
                  >
                    {heading}
                  </motion.span>
                </div>
                <p className="text-cyber-400 font-light leading-relaxed">
                  {text}
                </p>
              </div>
            </motion.div>
          </Transition>
        </Variants>
      </LayoutGroup>
    </div>
  );
};
