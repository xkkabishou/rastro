import React from 'react';
import { type HTMLMotionProps, motion } from 'framer-motion';

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', ...props }, ref) => {
    // Basic HIG-style button with spring physics
    const baseClasses = "inline-flex items-center justify-center rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:pointer-events-none disabled:opacity-50";

    const variants = {
      primary: "bg-primary text-text-on-primary hover:bg-primary-hover shadow-sm",
      secondary: "bg-bg-secondary text-text hover:bg-bg-tertiary",
      ghost: "hover:bg-hover hover:text-text text-text-secondary",
      destructive: "bg-destructive text-text-on-primary hover:opacity-90"
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
        aria-label={size === 'icon' && !props['aria-label'] && typeof props.children !== 'string' ? "图标按钮" : props['aria-label']}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
