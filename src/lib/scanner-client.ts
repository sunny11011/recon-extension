import { browser } from '#imports';
import { Wordlist, ScanResult, Finding, ScanOutput } from './types';

async function sendMessageToBackground<T = any>(message: any): Promise<T> {
  try {
    const response = await browser.runtime.sendMessage(message);
    if (response?.success === false) { 
      // Propagate cancellation errors without logging them as unexpected
      if (response.error === 'Scan cancelled') {
        return { success: false, error: 'Scan cancelled' } as T;
      }
      console.error(`Background script error for ${message.type}:`, response.error);
      return response;
    }
    return response;
  } catch (error: any) {
     console.error(`Error sending message to background: ${message.type}`, error);
     return { success: false, error: error.message } as T;
  }
}

async function runReconChecks(domain: string, wordlist: Wordlist): Promise<Finding[]> {
  const findings: Finding[] = [];
  const checks = JSON.parse(JSON.stringify(wordlist.endpoints));
  const seenFindings = new Set<string>();

  for (const check of checks) {
      try {
        const response = await sendMessageToBackground<{ success: boolean, status: number }>({
            type: 'CHECK_URL',
            url: `https://${domain}${check.path}`,
            domain: domain, // Pass domain for cancellation check
        });

        if (response && response.success && response.status === 200) {
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
        // If response.success is false, we just skip this path and continue.
      } catch (error) {
        console.warn(`Skipping path ${check.path} for domain ${domain} due to error:`, error);
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
            const sld = parts[parts.length-2];
            const commonSLDs = ['co', 'com', 'org', 'net', 'gov', 'edu', 'io'];
             if(commonSLDs.includes(sld) && parts.length > 2){
               return parts.slice(-3).join('.');
            }
           return parts.slice(-2).join('.');
        }
        return hostname;
    }
};

function isExcludedSubdomain(domain: string): boolean {
  const excludePatterns = [
    /^www\./i,
    /^webmail\./i,
    /^mail\./i,
    /^cpanel\./i,
    /^autodiscover\./i,
    /^shop\./i,
    /^blog\./i,
  ];
  return excludePatterns.some((pattern) => pattern.test(domain));
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
        // Pass rootDomain for cancellation check
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
      } else if (!response.success) {
        console.warn('Subdomain fetch failed:', response.error);
      }
    } catch (error) {
      console.warn('Subdomain fetch failed catastrophically:', error);
    }
  }
  
  // Convert set to array to control order: subdomains first.
  const subdomainsToScan = Array.from(collectedSubdomains);
  
  // Add the original input domain to the END of the list.
  const allDomainsToScan = [...subdomainsToScan, rootDomain];

  const scanPromises = allDomainsToScan.map(
    async (domain) => {
      try {
        const findings = await runReconChecks(domain, input.wordlist);
        let status: ScanResult['status'] = 'Secure';

        if (findings.length > 0) {
          const hasCritical = findings.some((f) => f.severity === 'Critical');
          const hasHigh = findings.some((f) => f.severity === 'High');
          const hasMedium = findings.some((f) => f.severity === 'Medium');

          if (hasCritical) status = 'Vulnerable';
          else if (hasHigh) status = 'Vulnerable';
          else if (hasMedium) status = 'Potentially Vulnerable';
          else status = 'Scanned';
        }
        return { domain, status, ip: null, findings };
      } catch (e) {
          // If runReconChecks has an unexpected failure, log it and return null
          // so that Promise.all doesn't fail the entire scan.
          console.error(`An unexpected error occurred while scanning ${domain}:`, e);
          return null;
      }
    }
  );

  const results = (await Promise.all(scanPromises)).filter(
    (r): r is ScanResult => r !== null
  );

  if (results.length === 0) {
    // This now only throws if NO domains (root or sub) could be analyzed at all.
    throw new Error(`Scan failed for ${rootDomain}. No domains could be analyzed.`);
  }

  return { results, rawData };
}
