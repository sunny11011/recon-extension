import { create } from 'zustand';
import { useEffect } from 'react';
import { browser } from '#imports';
import { browserStorage } from '../lib/storage';
import { performScan, getRootDomain } from '../lib/scanner-client';
import defaultWordlist from '../lib/wordlists.json';
import type { ScanResult } from '../lib/types';
import { useToast } from './use-toast';

type HistoryItem = {
  result: ScanResult[];
  scannedAt: string;
  rootDomain: string;
};

interface ScanHistoryState {
  sessionDomains: string[];
  history: HistoryItem[];
  scanQueue: string[];
  isProcessingQueue: boolean;
  currentlyScanningDomain: string | null;
  ignoredDomains: string[];
  initialQueueLength: number;
  setHistory: (history: HistoryItem[]) => void;
  setIgnoredDomains: (domains: string[]) => void;
  addScanToQueue: (domain: string) => void;
  addScanResults: (results: ScanResult[]) => void;
  processQueue: () => Promise<void>;
  skipCurrentScan: () => void;
  stopAllScans: () => void;
  clearSession: () => void;
  deleteHistoryItem: (rootDomain: string) => void;
  addIgnoredDomain: (domain: string) => void;
  removeIgnoredDomain: (domain: string) => void;
  _init: () => Promise<void>;
}

const useStore = create<ScanHistoryState>((set, get) => ({
  sessionDomains: [],
  history: [],
  scanQueue: [],
  isProcessingQueue: false,
  currentlyScanningDomain: null,
  ignoredDomains: [],
  initialQueueLength: 0,
  
  _init: async () => {
    const [history, ignoredDomains] = await Promise.all([
      browserStorage.get<HistoryItem[]>('scan-history'),
      browserStorage.get<string[]>('ignored-domains'),
    ]);
    if (history) set({ history });
    if (ignoredDomains) set({ ignoredDomains });
  },

  setHistory: (history) => {
    set({ history });
    browserStorage.set('scan-history', history);
  },
  setIgnoredDomains: (ignoredDomains) => {
    set({ ignoredDomains });
    browserStorage.set('ignored-domains', ignoredDomains);
  },

  addScanToQueue: (domain) => {
    const rootDomain = getRootDomain(domain);
    if (!rootDomain) return;

    set((state) => {
      const isAlreadyQueued = state.scanQueue.includes(rootDomain);
      const isCurrentlyScanning = state.currentlyScanningDomain === rootDomain;
      const wasScannedInHistory = state.history.some(item => item.rootDomain === rootDomain);
      const isIgnored = state.ignoredDomains.includes(rootDomain);

      if (isAlreadyQueued || isCurrentlyScanning || isIgnored || wasScannedInHistory) {
        console.log(`[zustand] Skipping ${rootDomain}: already handled.`);
        return {}; // No change
      }
      
      console.log(`[zustand] Adding ${rootDomain} to scan queue.`);
      const newQueue = [...state.scanQueue, rootDomain];
      return { 
          scanQueue: newQueue,
          initialQueueLength: state.isProcessingQueue ? state.initialQueueLength : newQueue.length
      };
    });
  },

  addScanResults: (results) => {
    if (!results || results.length === 0) return;
    const rootDomain = getRootDomain(results[0].domain);
    if (!rootDomain) return;

    const newHistoryItem: HistoryItem = {
      result: results,
      scannedAt: new Date().toISOString(),
      rootDomain,
    };

    set((state) => {
      const newHistory = [newHistoryItem, ...state.history.filter((h) => h.rootDomain !== rootDomain)];
      const newSessionDomains = Array.from(new Set([...state.sessionDomains, rootDomain]));
      
      browserStorage.set('scan-history', newHistory);
      
      return {
        history: newHistory,
        sessionDomains: newSessionDomains,
      };
    });
  },

  processQueue: async () => {
    const state = get();
    if (state.isProcessingQueue || state.scanQueue.length === 0) {
      if (state.scanQueue.length === 0) {
          set({ isProcessingQueue: false, currentlyScanningDomain: null, initialQueueLength: 0 });
      }
      return;
    }
    
    if (!state.isProcessingQueue) {
        set({ initialQueueLength: state.scanQueue.length });
    }

    const domainToScan = state.scanQueue[0];
    set({ isProcessingQueue: true, currentlyScanningDomain: domainToScan });
    console.log(`[zustand] Processing queue for: ${domainToScan}`);
    
    // Tell the background script to start a new scan session (and get a new AbortController)
    await browser.runtime.sendMessage({ type: 'START_SCAN_SESSION', domain: domainToScan });

    try {
      const settings = await browserStorage.get<{ 'viewdns-key'?: string, 'wordlist'?: typeof defaultWordlist } >('settings');
      
      const scanOutput = await performScan({
        domain: domainToScan,
        apiKey: settings?.['viewdns-key'] || '',
        wordlist: settings?.wordlist || defaultWordlist,
      });

      if (get().currentlyScanningDomain !== domainToScan) {
         console.log(`[zustand] Scan for ${domainToScan} was skipped or cancelled. Discarding results.`);
         return;
      }
      
      if (scanOutput?.results?.length > 0) {
        get().addScanResults(scanOutput.results);
        toast({
          title: 'Scan Complete',
          description: `Found results for ${domainToScan}`,
        });
      } else {
        toast({
          title: 'Scan Complete',
          description: `No vulnerabilities found for ${domainToScan}.`,
        });
         set((prevState) => ({
            sessionDomains: Array.from(new Set([...prevState.sessionDomains, domainToScan]))
        }));
      }
    } catch (error: any) {
       if (get().currentlyScanningDomain === domainToScan) {
          console.error(`[zustand] Scan failed for ${domainToScan}:`, error);
          if (error.message !== 'Scan cancelled') {
            toast({
              variant: 'destructive',
              title: 'Scan Failed',
              description: error.message || `Could not scan ${domainToScan}`,
            });
          }
       }
    } finally {
      if (get().currentlyScanningDomain === domainToScan) {
        set((prevState) => ({
          scanQueue: prevState.scanQueue.slice(1),
          isProcessingQueue: false,
          currentlyScanningDomain: null,
        }));
      }
    }
  },

  skipCurrentScan: () => {
    const state = get();
    const domainToSkip = state.currentlyScanningDomain;
    if (!domainToSkip) return;

    console.log(`[zustand] Skipping scan for ${domainToSkip}`);
    toast({
      title: 'Scan Skipped',
      description: `Skipped scanning for ${domainToSkip}.`,
    });
    
    // Tell the background script to cancel ongoing operations for this domain
    browser.runtime.sendMessage({ type: 'CANCEL_SCAN', domain: domainToSkip });

    set({
      scanQueue: state.scanQueue.slice(1),
      isProcessingQueue: false,
      currentlyScanningDomain: null,
    });
  },

  stopAllScans: () => {
    const { currentlyScanningDomain, scanQueue } = get();
    const allDomains = Array.from(new Set([currentlyScanningDomain, ...scanQueue].filter(Boolean)));
    
    console.log('[zustand] Stopping all scans.');
    toast({
      title: 'All Scans Stopped',
      description: 'The scan queue has been cleared.',
    });

    allDomains.forEach(domain => {
      if (domain) browser.runtime.sendMessage({ type: 'CANCEL_SCAN', domain });
    });

    set({
      scanQueue: [],
      isProcessingQueue: false,
      currentlyScanningDomain: null,
      initialQueueLength: 0
    });
  },

  clearSession: () => set({ sessionDomains: [] }),

  deleteHistoryItem: (rootDomain) => {
    set((state) => {
      const newHistory = state.history.filter((h) => h.rootDomain !== rootDomain);
      browserStorage.set('scan-history', newHistory);
      return { history: newHistory };
    });
  },

  addIgnoredDomain: (domain) => {
    set((state) => {
      const newIgnored = Array.from(new Set([...state.ignoredDomains, domain]));
      browserStorage.set('ignored-domains', newIgnored);
      return { ignoredDomains: newIgnored };
    });
  },

  removeIgnoredDomain: (domain) => {
    set((state) => {
      const newIgnored = state.ignoredDomains.filter((d) => d !== domain);
      browserStorage.set('ignored-domains', newIgnored);
      return { ignoredDomains: newIgnored };
    });
  },
}));

let isInitialized = false;

export function useScanHistory() {
  const state = useStore();

  useEffect(() => {
    if (!isInitialized) {
      console.log('[useScanHistory] Initializing state from storage...');
      state._init();
      
      const messageListener = (message: any) => {
          if (message.type === 'ADD_TO_QUEUE' && message.domain) {
              console.log('[useScanHistory] Received ADD_TO_QUEUE message from background.');
              state.addScanToQueue(message.domain);
          }
      };
      browser.runtime.onMessage.addListener(messageListener);
      isInitialized = true;
    }
  }, []);

  useEffect(() => {
    if (state.scanQueue.length > 0 && !state.isProcessingQueue) {
      state.processQueue();
    }
  }, [state.scanQueue, state.isProcessingQueue]);

  return {
    ...state,
    sessionResults: state.history
      .filter((item) => state.sessionDomains.includes(item.rootDomain))
      .flatMap((item) => item.result)
  };
}
