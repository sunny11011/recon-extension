import { create } from 'zustand';
import { useEffect } from 'react';
import { browser } from '#imports';
import { browserStorage } from '../lib/storage';
import { performScan, getRootDomain } from '../lib/scanner-client';
import defaultWordlist from '../lib/wordlists.json';
import type { ScanResult } from '../lib/types';
import { toast } from './use-toast';

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
  setHistory: (history: HistoryItem[]) => void;
  setIgnoredDomains: (domains: string[]) => void;
  addScanToQueue: (domain: string) => void;
  addScanResults: (results: ScanResult[]) => void;
  processQueue: () => Promise<void>;
  skipCurrentScan: () => void;
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
      const wasScannedInSession = state.sessionDomains.includes(rootDomain);

      if (isAlreadyQueued || isCurrentlyScanning || wasScannedInSession) {
        return {}; // No change
      }
      
      console.log(`[zustand] Adding ${rootDomain} to scan queue.`);
      return { scanQueue: [...state.scanQueue, rootDomain] };
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
      return;
    }

    const domainToScan = state.scanQueue[0];
    set({ isProcessingQueue: true, currentlyScanningDomain: domainToScan });
    console.log(`[zustand] Processing queue for: ${domainToScan}`);

    try {
      const apiKey = await browserStorage.get<string>('viewdns-key');
      const wordlistData = await browserStorage.get<typeof defaultWordlist>('wordlist') || defaultWordlist;
      
      const scanOutput = await performScan({
        domain: domainToScan,
        apiKey: apiKey || '',
        wordlist: wordlistData,
      });

      if (scanOutput?.results?.length > 0) {
        get().addScanResults(scanOutput.results);
        toast({
          title: 'Scan Complete',
          description: `Found ${scanOutput.results.length} results for ${domainToScan}`,
        });
      } else {
        toast({
          title: 'Scan Complete',
          description: `No vulnerabilities found for ${domainToScan}.`,
        });
      }
    } catch (error: any) {
      console.error(`[zustand] Scan failed for ${domainToScan}:`, error);
      toast({
        variant: 'destructive',
        title: 'Scan Failed',
        description: error.message || `Could not scan ${domainToScan}`,
      });
    } finally {
      console.log(`[zustand] Finished processing: ${domainToScan}`);
      set((prevState) => ({
        isProcessingQueue: false,
        currentlyScanningDomain: null,
        scanQueue: prevState.scanQueue.slice(1),
        sessionDomains: Array.from(new Set([...prevState.sessionDomains, domainToScan]))
      }));
    }
  },

  skipCurrentScan: () => {
    set((state) => {
      if (!state.currentlyScanningDomain) return {};
      toast({
        title: 'Scan Skipped',
        description: `Skipped scanning for ${state.currentlyScanningDomain}.`,
      });
      return {
        isProcessingQueue: false,
        currentlyScanningDomain: null,
        scanQueue: state.scanQueue.slice(1),
      };
    });
  },

  clearSession: () => set({ sessionDomains: [] }),

  deleteHistoryItem: (rootDomain) => {
    set((state) => {
      const newHistory = state.history.filter((h) => h.rootDomain !== rootDomain);
      const newSessionDomains = state.sessionDomains.filter((d) => d !== rootDomain);
      browserStorage.set('scan-history', newHistory);
      return {
        history: newHistory,
        sessionDomains: newSessionDomains,
      };
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

// A flag to ensure initialization happens only once
let isInitialized = false;

export function useScanHistory() {
  const state = useStore();

  useEffect(() => {
    if (!isInitialized) {
      console.log('[useScanHistory] Initializing state from storage...');
      state._init();
      isInitialized = true;
    }
  }, []);

  useEffect(() => {
    // This effect runs whenever the queue changes or processing stops
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
