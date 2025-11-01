import { create } from 'zustand';
import { browser } from '#imports';
import { browserStorage } from '../lib/storage';
import { performScan, getRootDomain } from '../lib/scanner-client';
import defaultWordlist from '../lib/wordlists.json';
import { ScanResult } from '../lib/types';
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
}

const useStore = create<ScanHistoryState>((set, get) => ({
  sessionDomains: [],
  history: [],
  scanQueue: [],
  isProcessingQueue: false,
  currentlyScanningDomain: null,
  ignoredDomains: [],
  setHistory: (history) => set({ history }),
  setIgnoredDomains: (ignoredDomains) => set({ ignoredDomains }),
  addScanToQueue: (domain) => {
    const rootDomain = getRootDomain(domain);
    if (!rootDomain) return;

    set((state) => {
      // Check if domain is already being processed or in queue
      if (
        state.currentlyScanningDomain === rootDomain ||
        state.scanQueue.includes(rootDomain) ||
        state.sessionDomains.includes(rootDomain)
      ) {
        return state;
      }

      // Add to queue and start processing if not already processing
      const newQueue = [...state.scanQueue, rootDomain];
      return { 
        scanQueue: newQueue,
        // If nothing is being processed, start with this domain
        currentlyScanningDomain: state.currentlyScanningDomain || (newQueue.length === 1 ? rootDomain : null)
      };
    });

    // Automatically start processing if not already processing
    const state = get();
    if (!state.isProcessingQueue) {
      get().processQueue();
    }
  },
  addScanResults: async (results) => {
    if (!results || results.length === 0) return;

    const rootDomain = getRootDomain(results[0].domain);
    const now = new Date().toISOString();
    const newHistoryItem = {
      result: results,
      scannedAt: now,
      rootDomain: rootDomain,
    };

    set((state) => {
      const newHistory = [
        ...state.history.filter((h) => h.rootDomain !== rootDomain),
        newHistoryItem,
      ];
      const newSessionDomains = Array.from(
        new Set([...state.sessionDomains, rootDomain])
      );

      // Persist to storage
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

    set({ isProcessingQueue: true });
    const domainToScan = state.scanQueue[0];
    set({ currentlyScanningDomain: domainToScan });

    try {
      const apiKey = await browserStorage.get<string>('viewdns-key');
      const wordlistData = await browserStorage.get<typeof defaultWordlist>('wordlist');
      
      const scanOutput = await performScan({
        domain: domainToScan,
        apiKey: apiKey || '',
        wordlist: wordlistData || defaultWordlist,
      });

      if (scanOutput?.results?.length > 0) {
        get().addScanResults(scanOutput.results);
        toast({
          title: 'Scan Complete',
          description: `Found ${scanOutput.results.length} results for ${domainToScan}`,
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Scan Failed',
        description: error.message || `Could not scan ${domainToScan}`,
      });
    } finally {
      set((state) => ({
        isProcessingQueue: false,
        currentlyScanningDomain: null,
        scanQueue: state.scanQueue.slice(1),
      }));

      // Process next in queue if any
      const updatedState = get();
      if (updatedState.scanQueue.length > 0) {
        setTimeout(() => get().processQueue(), 1000); // Small delay between scans
      }
    }
  },
  skipCurrentScan: () => {
    const state = get();
    if (!state.isProcessingQueue || !state.currentlyScanningDomain) return;

    const skippedDomain = state.currentlyScanningDomain;

    toast({
      title: 'Scan Skipped',
      description: `Skipped scanning for ${skippedDomain}.`,
    });

    set({
      isProcessingQueue: false,
      currentlyScanningDomain: null,
      scanQueue: state.scanQueue.slice(1),
    });
  },
  clearSession: () => set({ sessionDomains: [] }),
  deleteHistoryItem: (rootDomain) => {
    set((state) => ({
      history: state.history.filter((h) => h.rootDomain !== rootDomain),
      sessionDomains: state.sessionDomains.filter((d) => d !== rootDomain),
    }));
  },
  addIgnoredDomain: (domain) => {
    set((state) => ({
      ignoredDomains: Array.from(new Set([...state.ignoredDomains, domain])),
    }));
  },
  removeIgnoredDomain: (domain) => {
    set((state) => ({
      ignoredDomains: state.ignoredDomains.filter((d) => d !== domain),
    }));
  },
}));

export function useScanHistory() {
  const state = useStore();

  // Auto-process queue when items are added
  useEffect(() => {
    if (state.scanQueue.length > 0 && !state.isProcessingQueue) {
      state.processQueue();
    }
  }, [state.scanQueue.length, state.isProcessingQueue]);

  // Listen for background scan triggers
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'TRIGGER_SCAN') {
        useStore.getState().addScanToQueue(message.domain);
      }
    };

    browser.runtime.onMessage.addListener(messageListener);
    return () => browser.runtime.onMessage.removeListener(messageListener);
  }, []);

  // Auto-scan current tab
  useEffect(() => {
    async function autoScanCurrentTab() {
      try {
        const isAutoScanEnabled = await browserStorage.get<boolean>('auto-scan-enabled');
        if (!isAutoScanEnabled) return;

        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        
        if (tab?.url) {
          const rootDomain = getRootDomain(tab.url);
          if (rootDomain) {
            useStore.getState().addScanToQueue(rootDomain);
          }
        }
      } catch (error) {
        console.error('Error during auto scan:', error);
      }
    }
    autoScanCurrentTab();
  }, []);

  // Load persisted state
  useEffect(() => {
    async function loadPersistedState() {
      try {
        const [history, ignoredDomains] = await Promise.all([
          browserStorage.get<typeof state.history>('scan-history'),
          browserStorage.get<string[]>('ignored-domains')
        ]);

        if (history) useStore.getState().setHistory(history);
        if (ignoredDomains) useStore.getState().setIgnoredDomains(ignoredDomains);
      } catch (error) {
        console.error('Error loading persisted state:', error);
      }
    }
    loadPersistedState();
  }, []);

  return {
    ...state,
    sessionResults: state.history
      .filter((item) => state.sessionDomains.includes(item.rootDomain))
      .flatMap((item) => item.result)
  };
}
