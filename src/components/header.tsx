import React from 'react';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import {
  Github,
  History,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings,
  ShieldHalf,
} from 'lucide-react';
import { useScanHistory } from '../hooks/use-scan-history';

interface HeaderProps {
  activeView: string;
  setActiveView: (view: string) => void;
}

export function Header({ activeView, setActiveView }: HeaderProps) {
  const { clearSession } = useScanHistory();

  const menuItems = [
    { name: 'Dashboard', icon: LayoutDashboard },
    { name: 'Dorking', icon: Search },
    { name: 'History', icon: History },
    { name: 'Settings', icon: Settings },
  ];

  return (
    <TooltipProvider>
      <header className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2">
          <ShieldHalf className="w-7 h-7 text-primary" />
          <span className="font-semibold text-lg">H4ckoverflow</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearSession}
                disabled={activeView !== 'Dashboard'}
              >
                <RefreshCw className="h-5 w-5" />
                <span className="sr-only">Clear Session</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Clear Session Results</p>
            </TooltipContent>
          </Tooltip>

          {menuItems.map((item) => (
            <Tooltip key={item.name}>
              <TooltipTrigger asChild>
                <Button
                  variant={activeView === item.name ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => setActiveView(item.name)}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="sr-only">{item.name}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{item.name}</p>
              </TooltipContent>
            </Tooltip>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/h4ck0v3rflow"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button asChild variant="ghost" size="icon">
                  <Github className="h-5 w-5" />
                </Button>
                <span className="sr-only">GitHub</span>
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <p>GitHub</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
