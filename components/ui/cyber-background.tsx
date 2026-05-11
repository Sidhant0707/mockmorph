"use client";

import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import * as THREE from "three";

export default function CyberBackground() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const mountElement = mountRef.current; // capture ref value for cleanup
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    camera.position.set(0, 0, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountElement.appendChild(renderer.domElement);

    const wireMat = new THREE.LineBasicMaterial({
      color: 0x334155,
      transparent: true,
      opacity: 0.35,
    });
    const pointMat = new THREE.PointsMaterial({
      color: 0x475569,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
    });

    const structures: {
      mesh: THREE.LineSegments;
      rotSpeed: number;
      floatAmp: number;
      baseY: number;
      floatSpeed: number;
    }[] = [];

    const icoGeo = new THREE.IcosahedronGeometry(5, 1);
    const icoLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(icoGeo),
      wireMat,
    );
    icoLine.position.set(-14, 8, -10);
    scene.add(icoLine);
    structures.push({
      mesh: icoLine,
      rotSpeed: 0.001,
      floatAmp: 2,
      baseY: 8,
      floatSpeed: 0.4,
    });

    const octGeo = new THREE.OctahedronGeometry(3.5, 0);
    const octLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(octGeo),
      wireMat,
    );
    octLine.position.set(16, -4, -8);
    scene.add(octLine);
    structures.push({
      mesh: octLine,
      rotSpeed: 0.0015,
      floatAmp: 1.5,
      baseY: -4,
      floatSpeed: 0.3,
    });

    const torusGeo = new THREE.TorusKnotGeometry(2.5, 0.4, 80, 8, 2, 3);
    const torusLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(torusGeo),
      new THREE.LineBasicMaterial({
        color: 0x1e293b,
        transparent: true,
        opacity: 0.2,
      }),
    );
    torusLine.position.set(4, -14, -12);
    scene.add(torusLine);
    structures.push({
      mesh: torusLine,
      rotSpeed: 0.0008,
      floatAmp: 1,
      baseY: -14,
      floatSpeed: 0.25,
    });

    const particleCount = 200;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      particlePos[i * 3] = (Math.random() - 0.5) * 60;
      particlePos[i * 3 + 1] = (Math.random() - 0.5) * 50;
      particlePos[i * 3 + 2] = (Math.random() - 0.5) * 30 - 10;
    }
    particleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePos, 3),
    );
    const particleField = new THREE.Points(particleGeo, pointMat);
    scene.add(particleField);

    let targetRotX = 0;
    let targetRotY = 0;
    let scrollY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      targetRotY = (e.clientX / window.innerWidth - 0.5) * 0.5;
      targetRotX = (e.clientY / window.innerHeight - 0.5) * 0.5;
    };

    const handleScroll = () => {
      scrollY = window.scrollY;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("scroll", handleScroll);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    let animationFrameId: number;
    const clock = new THREE.Timer();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const t = clock.getElapsed();

      camera.rotation.x += (targetRotX - camera.rotation.x) * 0.02;
      camera.rotation.y += (targetRotY - camera.rotation.y) * 0.02;
      camera.position.y = -scrollY * 0.005;

      structures.forEach((s, i) => {
        s.mesh.rotation.x += s.rotSpeed;
        s.mesh.rotation.y += s.rotSpeed * 1.2;
        s.mesh.position.y =
          s.baseY + Math.sin(t * s.floatSpeed + i) * s.floatAmp;
      });

      particleField.rotation.y = t * 0.02 + scrollY * 0.00005;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      if (mountElement) {
        mountElement.removeChild(renderer.domElement);
      }
      renderer.dispose();
      icoGeo.dispose();
      octGeo.dispose();
      torusGeo.dispose();
      particleGeo.dispose();
      wireMat.dispose();
      pointMat.dispose();
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div
        className="absolute left-0 top-0 h-[600px] w-[600px] rounded-full opacity-[0.03] bg-[radial-gradient(circle,#475569_0%,transparent_70%)]"
      />
      <div
        className="absolute bottom-0 right-0 h-[800px] w-[800px] rounded-full opacity-[0.025] bg-[radial-gradient(circle,#64748b_0%,transparent_70%)]"
      />
      <div
        className="absolute left-1/2 top-1/2 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.015] bg-[radial-gradient(circle,#334155_0%,transparent_60%)]"
      />

      <div
        className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:24px_24px]"
      />

      <motion.div
        className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-white/10 to-transparent shadow-[0_0_8px_rgba(255,255,255,0.1)]"
        animate={{ top: ["-5%", "105%"] }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />

      <div ref={mountRef} className="absolute inset-0" />
    </div>
  );
}
