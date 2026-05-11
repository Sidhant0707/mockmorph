import React from 'react';

export const MockMorphLogo = ({ className = "w-8 h-8" }: { className?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 64 64" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Outer Isometric Database Hexagon */}
    <path 
      d="M32 4L58 19V45L32 60L6 45V19L32 4Z" 
      stroke="#334155" 
      strokeWidth="2" 
      strokeLinejoin="round"
    />
    
    {/* Background Echo Stream */}
    <path 
      d="M14 38V19L32 28L50 19V38" 
      stroke="#64748b" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeOpacity="0.4"
    />

    {/* The Core 'MM' Monogram */}
    <path 
      d="M20 45V25L32 35L44 25V45" 
      stroke="#f8fafc" 
      strokeWidth="4" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    />
  </svg>
);