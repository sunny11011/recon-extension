import { defineBackground, browser } from '#imports';
import { browserStorage } from '../lib/storage';
import { getRootDomain } from '../lib/scanner-client';

const STEALTH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

export default defineBackground(() => {
  let pendingScan: string | null = null;
  let cancelledScans = new Set<string>();

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
    
    if (message.domain && cancelledScans.has(getRootDomain(message.domain))) {
        console.log(`[background] Scan for ${message.domain} is cancelled. Ignoring message type: ${message.type}`);
        return { success: false, error: 'Scan cancelled' };
    }

    switch (message.type) {
      case 'CHECK_URL':
        return await checkUrl(message.url);
      
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
        if (message.domain) {
            console.log(`[background] Adding ${message.domain} to cancellation list.`);
            cancelledScans.add(message.domain);
        }
        return { success: true };
      
      case 'CLEAR_CANCELLED':
         if (message.domain) {
            console.log(`[background] Removing ${message.domain} from cancellation list.`);
            cancelledScans.delete(message.domain);
        }
        return { success: true };

      default:
        console.warn('[background] Unknown message type:', message.type);
        return { success: false, error: `Unknown message type: ${message.type}` };
    }
  }

  // Auto-scan logic on tab updates
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Trigger scan as soon as the URL is available and changes
    if (changeInfo.url && changeInfo.url.startsWith('http')) {
      console.log('[background] Tab URL changed:', changeInfo.url);
      try {
        await triggerScan(changeInfo.url);
      } catch (error) => {
        console.error('[background] Error triggering auto-scan:', error);
      }
    }
  });

  async function checkUrl(url: string) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: STEALTH_HEADERS,
        redirect: 'follow',
      });
      // Return the final status after redirects
      return { success: true, status: response.status };
    } catch (error: any) {
      console.error(`[background] checkUrl failed for ${url}:`, error);
      // Specifically check for timeout or connection errors
      if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
        // This often corresponds to net::ERR_CONNECTION_TIMED_OUT or similar network issues
        return { success: false, error: 'Connection timed out or failed', status: 0 };
      }
      return { success: false, error: error.message, status: 0 };
    }
  }
  
  async function fetchSubdomains(domain: string, apiKey: string) {
    if (!apiKey) {
      // Return an empty success response if no API key is provided.
      return { success: true, data: { response: { domains: [] } } };
    }
    const url = `https://api.viewdns.info/subdomains/?domain=${domain}&apikey=${apiKey}&output=json`;
    try {
      const response = await fetch(url, { headers: STEALTH_HEADERS });
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
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
        pendingScan = rootDomain;
        console.log(`[background] Pending scan set for: ${rootDomain}`);
        
        try {
            await browser.runtime.sendMessage({ type: 'ADD_TO_QUEUE', domain: rootDomain });
        } catch (e) {
            console.log("[background] Popup not open, scan will be added on next open.");
        }

        return { success: true, pending: true };
      } else {
        console.log(`[background] Scan for ${rootDomain} skipped (ignored or already scanned).`);
      }
    }
    return { success: true, pending: false };
  }
});
