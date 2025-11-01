import { defineBackground, browser } from '#imports';
import { browserStorage } from '../lib/storage';
import { getRootDomain } from '../lib/scanner-client';

const STEALTH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

// Use an AbortController to allow scans to be cancelled
const activeScans = new Map<string, AbortController>();

export default defineBackground(() => {
  let pendingScan: string | null = null;

  // Primary message listener
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('[background] Error handling message:', message.type, error);
        sendResponse({ success: false, error: error.message || 'An unknown error occurred' });
      });
    return true; // Indicates we will respond asynchronously
  });

  async function handleMessage(message: any, sender: any) {
    console.log('[background] Received message:', message.type);

    const scanId = message.domain ? getRootDomain(message.domain) : null;
    const controller = scanId ? activeScans.get(scanId) : null;

    if (controller?.signal.aborted) {
      console.log(`[background] Scan for ${scanId} was cancelled. Ignoring message type: ${message.type}`);
      return { success: false, error: 'Scan cancelled' };
    }

    switch (message.type) {
      case 'CHECK_URL':
        if (!scanId) return { success: false, error: 'No domain specified for CHECK_URL' };
        if (!activeScans.has(scanId)) {
           activeScans.set(scanId, new AbortController());
        }
        return await checkUrl(message.url, activeScans.get(scanId)!.signal);

      case 'FETCH_SUBDOMAINS':
        return await fetchSubdomains(message.domain, message.apiKey);

      case 'TRIGGER_SCAN':
        return await triggerScan(message.url);

      case 'GET_PENDING_SCAN':
        if (pendingScan) {
          const domain = pendingScan;
          pendingScan = null; // Clear after retrieving
          console.log('[background] Delivering pending scan for:', domain);
          return { success: true, domain };
        }
        return { success: true, domain: null };

      case 'CANCEL_SCAN':
        if (scanId && activeScans.has(scanId)) {
          console.log(`[background] Cancelling scan for ${scanId}`);
          activeScans.get(scanId)!.abort();
          activeScans.delete(scanId);
        }
        return { success: true };

      case 'START_SCAN_SESSION':
         if (scanId) {
            console.log(`[background] Starting new scan session for ${scanId}`);
            // If a controller already exists, abort it before creating a new one
            if (activeScans.has(scanId)) {
              activeScans.get(scanId)!.abort();
            }
            activeScans.set(scanId, new AbortController());
         }
         return { success: true };

      default:
        console.warn('[background] Unknown message type:', message.type);
        return { success: false, error: `Unknown message type: ${message.type}` };
    }
  }

  // Auto-scan logic on tab updates
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url && changeInfo.url.startsWith('http')) {
      console.log('[background] Tab URL changed:', changeInfo.url);
      try {
        await triggerScan(changeInfo.url);
      } catch (error) {
        console.error('[background] Error triggering auto-scan:', error);
      }
    }
  });

  async function checkUrl(url: string, signal: AbortSignal) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: STEALTH_HEADERS,
        redirect: 'follow',
        signal: signal,
      });
      return { success: true, status: response.status };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(`[background] Fetch aborted for ${url}`);
        return { success: false, error: 'Scan cancelled', status: 0 };
      }
      console.error(`[background] checkUrl failed for ${url}:`, error);
      if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
        return { success: false, error: 'Connection timed out or failed', status: 0 };
      }
      return { success: false, error: error.message, status: 0 };
    }
  }

  async function fetchSubdomains(domain: string, apiKey: string) {
    if (!apiKey) {
      return { success: true, data: { response: { domains: [] } } };
    }
    const url = `https://api.viewdns.info/subdomains/?domain=${domain}&apikey=${apiKey}&output=json`;
    try {
      const response = await fetch(url, { headers: STEALTH_HEADERS });
      if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
      const data = await response.json();
      return { success: true, data };
    } catch (error: any) {
      console.error(`[background] fetchSubdomains failed for ${domain}:`, error);
      return { success: false, error: `Failed to fetch subdomains: ${error.message}` };
    }
  }

  async function triggerScan(url: string) {
    const settings = await browserStorage.get<{ 'auto-scan-enabled'?: boolean }>('settings');
    const isAutoScanEnabled = settings?.['auto-scan-enabled'] ?? false;
    const rootDomain = getRootDomain(url);

    if (isAutoScanEnabled && rootDomain) {
      const history = await browserStorage.get<any[]>('scan-history') || [];
      const ignoredDomains = await browserStorage.get<string[]>('ignored-domains') || [];

      const alreadyScanned = history.some(item => item.rootDomain === rootDomain);
      const isIgnored = ignoredDomains.includes(rootDomain);

      if (!alreadyScanned && !isIgnored) {
        console.log(`[background] Auto-scan triggered for: ${rootDomain}`);
        try {
          // This message is "fire and forget" - it tries to add to the queue if the popup is open.
          // If not, the user will see it when they open the popup next.
          await browser.runtime.sendMessage({ type: 'ADD_TO_QUEUE', domain: rootDomain });
        } catch (e) {
          // This error is expected if the popup is not open.
          console.log("[background] Popup not open, setting as pending scan.");
          pendingScan = rootDomain;
        }
        return { success: true, pending: true };
      } else {
        console.log(`[background] Scan for ${rootDomain} skipped (ignored or already scanned).`);
      }
    }
    return { success: true, pending: false };
  }
});
