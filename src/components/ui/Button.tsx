import React from 'react';
import { motion } from 'framer-motion';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', ...props }, ref) => {
    // Basic HIG-style button with spring physics
    const baseClasses = "inline-flex items-center justify-center rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50";
    
    const variants = {
      primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
      secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
      ghost: "hover:bg-gray-100 hover:text-gray-900 text-gray-600",
      destructive: "bg-red-500 text-white hover:bg-red-600"
    };
    
    const sizes = {
      sm: "h-8 px-3 text-xs rounded-lg",
      md: "h-10 px-4 py-2 text-sm",
      lg: "h-12 px-8 text-base rounded-2xl",
      icon: "h-10 w-10 shrink-0"
    };

    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.96 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
        {...(props as any)}
      />
    );
  }
);
Button.displayName = "Button";
