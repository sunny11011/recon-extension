import { defineBackground } from '#imports';
import { browserStorage } from '../lib/storage';
import { getRootDomain } from '../lib/scanner-client';
import axios from 'axios';

const PROXY_CONFIG = {
  host: 'p.webshare.io',
  port: 80,
  auth: {
    username: "zjriifuo-rotate", // Replace with env or config
    password: "uqj15dchpk6h"  // Replace with env or config
  }
};

const STEALTH_HEADERS_HTML = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'no-cache'
};

const STEALTH_HEADERS_JSON = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'Cache-Control': 'no-cache'
};

export default defineBackground(() => {
  let pendingScan: string | null = null;

  // Handle all HTTP requests through background script
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse).catch(error => {
      console.error('Background script error:', error);
      sendResponse({ success: false, error: error.message || 'Request failed' });
    });
    return true; // Keep channel open for async response
  });

  // Separate async message handler
  async function handleMessage(message: any, sender: any) {
    try {
      switch (message.type) {
        case 'CHECK_URL':
          const response = await axios.get(message.url, {
            proxy: PROXY_CONFIG,
            headers: STEALTH_HEADERS_HTML,
            timeout: 8000,
            validateStatus: (status) => status < 500
          });
          
          return {
            success: true,
            status: response.status,
            data: response.data,
            headers: response.headers
          };

        case 'FETCH_SUBDOMAINS':
          const { domain, apiKey } = message;
          const url = `https://api.viewdns.info/subdomains/?domain=${domain}&apikey=${apiKey}&output=json`;
          
          const subdomainResponse = await axios.get(url, {
            proxy: PROXY_CONFIG,
            headers: STEALTH_HEADERS_JSON,
            validateStatus: (status) => status < 500
          });

          return {
            success: true,
            data: subdomainResponse.data
          };

        case 'TRIGGER_SCAN':
          const isAutoScanEnabled = await browserStorage.get<boolean>('auto-scan-enabled');
          const rootDomain = getRootDomain(message.url);
          
          if (isAutoScanEnabled && rootDomain) {
            const ignoredDomains = await browserStorage.get<string[]>('ignored-domains') || [];
            if (!ignoredDomains.includes(rootDomain)) {
              pendingScan = rootDomain;
              return { success: true, pending: true };
            }
          }
          return { success: true, pending: false };

        case 'GET_PENDING_SCAN':
          if (pendingScan) {
            const domain = pendingScan;
            pendingScan = null;
            return { success: true, domain };
          }
          return { success: true, domain: null };

        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error: any) {
      throw new Error(error.message || 'Request failed');
    }
  }

  // Auto-scan listener with retry logic
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      try {
        await browser.runtime.sendMessage({
          type: 'TRIGGER_SCAN',
          url: tab.url
        });
      } catch (error) {
        // Store the pending scan instead of immediately retrying
        const rootDomain = getRootDomain(tab.url);
        if (rootDomain) {
          pendingScan = rootDomain;
        }
      }
    }
  });
});