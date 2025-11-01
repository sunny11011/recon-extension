import { browser } from '#imports';
import { Wordlist, ScanResult, Finding, ScanOutput } from './types';

async function sendMessageToBackground<T = any>(message: any): Promise<T> {
  try {
    const response = await browser.runtime.sendMessage(message);
    if (response?.success === false) { 
      throw new Error(response.error || 'Background script returned an error');
    }
    return response;
  } catch (error: any) {
     console.error(`Error sending message to background: ${message.type}`, error);
     throw new Error(error.message);
  }
}

async function runReconChecks(domain: string, wordlist: Wordlist): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fullUrl = `https://${domain}`;
  const checks = JSON.parse(JSON.stringify(wordlist.endpoints));
  const seenFindings = new Set<string>();

  for (const check of checks) {
      try {
        const response = await sendMessageToBackground<{ success: boolean, status: number, finalUrl: string }>({
            type: 'CHECK_URL',
            url: `${fullUrl}${check.path}`
        });

        // A status of 200 means we found something.
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
        // If the response failed or status is not 200, we just ignore and continue.
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
        // Fallback for simple hostnames that might not parse as a full URL
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
  const domainsToScan = new Set<string>();
  const rootDomain = getRootDomain(input.domain);
  let rawData: any = null;

  // Always add the initial input domain
  domainsToScan.add(input.domain);
  // And its root, if different
  if (rootDomain !== input.domain) {
    domainsToScan.add(rootDomain);
  }

  if (input.apiKey) {
    try {
      const response = await sendMessageToBackground<{ data: any }>({
        type: 'FETCH_SUBDOMAINS',
        domain: rootDomain,
        apiKey: input.apiKey
      });
      
      rawData = response.data;
      if (response.data?.response?.domains) {
        let subdomains: string[] = response.data.response.domains;
        subdomains.forEach((subdomain: string) => {
          const name = subdomain.toLowerCase();
          if (!isExcludedSubdomain(name)) {
            domainsToScan.add(name);
          }
        });
      }
    } catch (error) {
      console.warn('Subdomain fetch failed, proceeding with root domain scan:', error);
    }
  }

  const scanPromises = Array.from(domainsToScan).map(
    async (domain) => {
      // Don't pre-check if a domain is live. Just try to scan it.
      // If runReconChecks returns no findings, that's fine.
      const findings = await runReconChecks(domain, input.wordlist);
      let status: ScanResult['status'] = 'Secure';

      if (findings.length > 0) {
        const hasCritical = findings.some((f) => f.severity === 'Critical');
        const hasHigh = findings.some((f) => f.severity === 'High');
        const hasMedium = findings.some((f) => f.severity === 'Medium');

        if (hasCritical) status = 'Vulnerable';
        else if (hasHigh) status = 'Vulnerable';
        else if (hasMedium) status = 'Potentially Vulnerable';
        else status = 'Scanned'; // Has findings, but none are Medium or higher
      }
      return { domain, status, ip: null, findings };
    }
  );

  const results = (await Promise.all(scanPromises)).filter(
    (r): r is ScanResult => r !== null
  );

  if (results.length === 0) {
    // This should now only happen if the initial domain is the only one and it fails completely.
    throw new Error(`Scan failed for ${rootDomain}. No domains could be analyzed.`);
  }

  return { results, rawData };
}
