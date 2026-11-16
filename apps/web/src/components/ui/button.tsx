import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          // Rule: black background with white text; on hover, white background with black text and a black border.
          'bg-black text-white border border-black hover:bg-white hover:text-black hover:border-black active:scale-[0.98]',
          size === 'default' && 'h-10 px-4 py-2',
          size === 'sm' && 'h-8 rounded-md px-3 text-xs',
          size === 'lg' && 'h-11 rounded-md px-8 text-base',
          size === 'icon' && 'h-10 w-10',
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
