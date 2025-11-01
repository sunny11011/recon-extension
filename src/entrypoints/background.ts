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
      
      default:
        console.warn('[background] Unknown message type:', message.type);
        return { success: false, error: `Unknown message type: ${message.type}` };
    }
  }

  // Auto-scan logic on tab updates
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
      console.log('[background] Tab updated:', tab.url);
      try {
        await triggerScan(tab.url);
      } catch (error) {
        console.error('[background] Error triggering auto-scan:', error);
      }
    }
  });

  // --- Helper Functions ---

  async function checkUrl(url: string) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: STEALTH_HEADERS,
        redirect: 'follow', // Fetch API follows redirects by default
        mode: 'cors'
      });

      // The response.url will be the final URL after all redirects.
      return { 
        success: true, 
        status: response.status, 
        finalUrl: response.url 
      };

    } catch (error: any) {
      console.error(`[background] checkUrl failed for ${url}:`, error);
      // Don't throw, just return a failure object so the client can handle it
      return { success: false, error: error.message, status: 0, finalUrl: url };
    }
  }
  
  async function fetchSubdomains(domain: string, apiKey: string) {
    if (!apiKey) {
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
      // Don't block the whole scan if this fails, just return no subdomains
      return { success: false, error: `Failed to fetch subdomains: ${error.message}` };
    }
  }
  
  async function triggerScan(url: string) {
    const settings = await browserStorage.get<{ 'auto-scan-enabled'?: boolean }>('settings');
    const isAutoScanEnabled = settings?.['auto-scan-enabled'] ?? false;
    const rootDomain = getRootDomain(url);
    
    if (isAutoScanEnabled && rootDomain) {
      const ignoredDomains = await browserStorage.get<string[]>('ignored-domains') || [];
      if (!ignoredDomains.includes(rootDomain)) {
        pendingScan = rootDomain;
        console.log(`[background] Pending scan set for: ${rootDomain}`);
        return { success: true, pending: true };
      }
    }
    return { success: true, pending: false };
  }
});
