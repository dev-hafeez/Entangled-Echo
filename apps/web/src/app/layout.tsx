import './globals.css';
import { ReactNode } from 'react';

export const metadata = {
  title: 'EntangledEcho Admin',
  description: 'EntangledEcho Minimal Scraper & ML Backend Admin',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b bg-white px-6 py-4 shadow-sm flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="font-bold text-xl tracking-tight text-slate-800">EntangledEcho</span>
            <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">Admin</span>
          </div>
          <nav className="flex items-center space-x-4 text-sm font-medium">
            <a href="/admin" className="hover:text-black">Dashboard</a>
          </nav>
        </header>
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
