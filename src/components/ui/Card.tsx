import React from 'react';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`rounded-[20px] border border-gray-200/50 bg-white/70 backdrop-blur-3xl shadow-apple-card ${className}`}
      {...props}
    />
  )
);
Card.displayName = "Card";
