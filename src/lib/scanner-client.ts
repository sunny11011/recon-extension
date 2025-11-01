import { browser } from '#imports';
import { Wordlist, ScanResult, Finding, ScanOutput } from './types';

async function sendMessageToBackground<T = any>(message: any): Promise<T> {
  try {
    const response = await browser.runtime.sendMessage(message);
    if (response?.success === false) {
      // Don't log cancellation as an unexpected error
      if (response.error === 'Scan cancelled') {
        throw new Error('Scan cancelled');
      }
      console.error(`Background script error for ${message.type}:`, response.error);
      throw new Error(response.error || `Background script error for ${message.type}`);
    }
    return response;
  } catch (error: any) {
    console.error(`Error sending message to background for ${message.type}:`, error.message);
    throw error; // Re-throw the error to be handled by the caller
  }
}

async function runReconChecks(domain: string, wordlist: Wordlist): Promise<Finding[]> {
  const findings: Finding[] = [];
  const checks = JSON.parse(JSON.stringify(wordlist.endpoints));
  const seenFindings = new Set<string>();

  for (const check of checks) {
    try {
      const response = await sendMessageToBackground<{ success: boolean, status: number, error?: string }>({
        type: 'CHECK_URL',
        url: `https://${domain}${check.path}`,
        domain: domain,
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
      // If the scan was cancelled, stop all further checks for this domain
      if (error.message === 'Scan cancelled') {
        console.log(`[scanner-client] Recon checks for ${domain} cancelled.`);
        throw error;
      }
      // Otherwise, just log and skip the failed path
      console.warn(`Skipping path ${check.path} for domain ${domain} due to error:`, error.message);
    }
  }

  return findings;
}

export function getRootDomain(domain: string): string {
  if (!domain) return '';
  try {
    const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    const parts = url.hostname.split('.');
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

    const results = await Promise.all(liveChecks);
    return results.filter(res => res.alive).map(res => res.domain);
}

export async function performScan(input: {
  domain: string;
  apiKey: string;
  wordlist: Wordlist;
}): Promise<ScanOutput> {
  const rootDomain = getRootDomain(input.domain);
  const collectedSubdomains = new Set<string>();
  let rawData: any = null;

  if (input.apiKey) {
    try {
      const response = await sendMessageToBackground<{ success: boolean, data: any, error?: string }>({
        type: 'FETCH_SUBDOMAINS',
        domain: rootDomain,
        apiKey: input.apiKey,
      });

      if (response.success && response.data?.response?.domains) {
        rawData = response.data;
        let subdomains: string[] = response.data.response.domains;
        subdomains.forEach((subdomain: string) => {
          const name = subdomain.toLowerCase();
          if (!isExcludedSubdomain(name)) {
            collectedSubdomains.add(name);
          }
        });
      }
    } catch (error: any) {
        if (error.message === 'Scan cancelled') throw error;
        console.warn('Subdomain fetch failed:', error.message);
    }
  }

  // Create the initial list of domains to check for liveness
  const allDomainsToCheck = Array.from(collectedSubdomains);
  if (!allDomainsToCheck.includes(rootDomain)) {
    allDomainsToCheck.push(rootDomain);
  }

  // Find live domains before performing the full scan
  const liveDomains = await getLiveDomains(allDomainsToCheck, rootDomain);
  
  if (liveDomains.length === 0) {
      return { results: [], rawData: null };
  }

  const scanPromises = liveDomains.map(async (domain) => {
    try {
      const findings = await runReconChecks(domain, input.wordlist);
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
      if (e.message === 'Scan cancelled') {
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

  if (results.length === 0 && liveDomains.length > 0) {
      // This can happen if the scan is cancelled mid-way through all domains
      throw new Error('Scan cancelled');
  }

  return { results, rawData };
}
