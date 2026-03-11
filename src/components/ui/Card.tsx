import React from 'react';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      role="region"
      className={`apple-card ${className}`}
      {...props}
    />
  )
);
Card.displayName = "Card";
