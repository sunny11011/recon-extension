
import { browser } from '#imports';
import { Wordlist, ScanResult, Finding, ScanOutput } from './types';

async function sendMessageToBackground<T = any>(message: any): Promise<T> {
  try {
    const response = await browser.runtime.sendMessage(message);
    if (response?.success === false) {
      console.error(`Background script error for ${message.type}:`, response.error);
      throw new Error(response.error || `Unknown background script error for ${message.type}`);
    }
    return response;
  } catch (error: any) {
    console.error(`Error sending message to background for ${message.type}:`, error.message);
    throw new Error(error.message || `Failed to send message for ${message.type}`);
  }
}

async function runReconChecks(domain: string, wordlist: Wordlist, rootDomain: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const checks = JSON.parse(JSON.stringify(wordlist.endpoints));
  const seenFindings = new Set<string>();

  for (const check of checks) {
    try {
      const response = await sendMessageToBackground<{ success: boolean, status: number, error?: string }>({
        type: 'CHECK_URL',
        url: `https://${domain}${check.path}`,
        domain: rootDomain,
      });

      if (response?.success && response.status === 200) {
        const severity = check.severity.charAt(0).toUpperCase() + check.severity.slice(1);
        const type = check.type === 'directory' ? 'Directory Listing' : 'Sensitive File';
        const findingKey = `${check.path}:${type}`;

        if (!seenFindings.has(findingKey)) {
          seenFindings.add(findingKey);
          findings.push({
            path: check.path,
            severity: severity,
            type: type,
            details: check.description,
          });
        }
      }
    } catch (error: any) {
      if (error.message.includes('cancelled')) {
        console.log(`[scanner-client] Recon checks for ${domain} cancelled.`);
        throw error;
      }
      console.warn(`Skipping path ${check.path} for domain ${domain} due to error:`, error.message);
    }
  }

  return findings;
}

export function getRootDomain(domain: string): string {
  if (!domain) return '';
  try {
    const url = new URL(domain.startsWith('http') ? domain : `https://www.google.com/search?q=${domain}`);
    const parts = url.hostname.split('.');
    if(url.hostname.endsWith('google.com')) {
      return domain;
    }
    if (parts.length > 2) {
      const sld = parts[parts.length - 2];
      const commonSLDs = ['co', 'com', 'org', 'net', 'gov', 'edu', 'io'];
      if (commonSLDs.includes(sld) && parts.length > 2) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    }
    return url.hostname;
  } catch (e) {
    const hostname = domain.split('/')[0];
    const parts = hostname.split('.');
    if (parts.length > 2) {
      const sld = parts[parts.length - 2];
      const commonSLDs = ['co', 'com', 'org', 'net', 'gov', 'edu', 'io'];
      if (commonSLDs.includes(sld) && parts.length > 2) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    }
    return hostname;
  }
}

function isExcludedSubdomain(domain: string): boolean {
  const excludePatterns = [
    /^www\./i, /^webmail\./i, /^mail\./i, /^cpanel\./i,
    /^autodiscover\./i, /^shop\./i, /^blog\./i,
  ];
  return excludePatterns.some((pattern) => pattern.test(domain));
}

async function getLiveDomains(domains: string[], rootDomain: string): Promise<string[]> {
    const liveChecks = domains.map(domain =>
      sendMessageToBackground<{ success: boolean, status: number }>({
        type: 'CHECK_URL',
        url: `https://${domain}`,
        domain: rootDomain,
      }).then(res => ({ domain, alive: res.success && res.status === 200 }))
        .catch(() => ({ domain, alive: false }))
    );
  
    const results = await Promise.allSettled(liveChecks);
    const liveDomains: string[] = [];
  
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.alive) {
        liveDomains.push(result.value.domain);
      }
    });
  
    return liveDomains;
}

type SubdomainRecord = { 
    name: string; 
    ips?: string[];
    last_resolved?: string | null;
};


export async function performScan(input: {
  domain: string;
  apiKey: string;
  wordlist: Wordlist;
}): Promise<ScanOutput> {
  const rootDomain = getRootDomain(input.domain);
  const subdomainsToCheck = new Set<string>();
  let rawData: any = null;
  const SUBDOMAIN_THRESHOLD = 50;

  if (input.apiKey) {
    try {
      const response = await sendMessageToBackground<{ success: boolean, data: any, error?: string }>({
        type: 'FETCH_SUBDOMAINS',
        domain: rootDomain,
        apiKey: input.apiKey,
      });

      if (response.success && response.data?.response?.domains) {
        rawData = response.data;
        let subdomains: SubdomainRecord[] = response.data.response.domains;
        const subdomainCount = response.data.response.subdomain_count ? parseInt(response.data.response.subdomain_count, 10) : 0;

        if (subdomainCount > SUBDOMAIN_THRESHOLD) {
            subdomains = subdomains.filter(record => record.last_resolved !== null);
        }
        if (subdomains.length > SUBDOMAIN_THRESHOLD) {
            subdomains = subdomains.filter(record => !/\d/.test(record.name));
        }
        if (subdomains.length > SUBDOMAIN_THRESHOLD) {
            subdomains = subdomains.slice(0, SUBDOMAIN_THRESHOLD);
        }

        subdomains.forEach((record) => {
          const name = record.name.toLowerCase();
          if (!isExcludedSubdomain(name)) {
            subdomainsToCheck.add(name);
          }
        });
      }
    } catch (error: any) {
        if (error.message.includes('cancelled')) throw error;
        console.warn('Subdomain fetch failed, continuing with root domain:', error.message);
    }
  }

  const allDomainsToCheck = Array.from(subdomainsToCheck);
  if (!allDomainsToCheck.includes(rootDomain)) {
    allDomainsToCheck.push(rootDomain);
  }

  const liveDomains = await getLiveDomains(allDomainsToCheck, rootDomain);
  
  if (liveDomains.length === 0) {
      console.log(`No live domains found for ${rootDomain} after checking ${allDomainsToCheck.length} potential domains.`);
      return { results: [], rawData: null };
  }

  console.log(`Found ${liveDomains.length} live domains. Starting vulnerability scan...`);

  const scanPromises = liveDomains.map(async (domain) => {
    try {
      const findings = await runReconChecks(domain, input.wordlist, rootDomain);
      let status: ScanResult['status'] = 'Secure';

      if (findings.length > 0) {
        const hasCritical = findings.some((f) => f.severity === 'Critical');
        const hasHigh = findings.some((f) => f.severity === 'High');
        const hasMedium = findings.some((f) => f.severity === 'Medium');

        if (hasCritical || hasHigh) status = 'Vulnerable';
        else if (hasMedium) status = 'Potentially Vulnerable';
        else status = 'Scanned';
      }
      return { domain, status, ip: null, findings };
    } catch (e: any) {
      if (e.message.includes('cancelled')) {
        console.log(`Scan for domain ${domain} was cancelled.`);
      } else {
        console.error(`An unexpected error occurred while scanning ${domain}:`, e);
      }
      return null;
    }
  });

  const results = (await Promise.all(scanPromises)).filter(
    (r): r is ScanResult => r !== null
  );

  return { results, rawData };
}
