import { browser } from '#imports';
import { Wordlist, ScanResult, Finding, ScanOutput } from './types';

async function sendMessageToBackground<T = any>(message: any): Promise<T> {
  try {
    const response = await browser.runtime.sendMessage(message);
    if (response?.success === false) { 
      // The background script caught an error and reported it.
      throw new Error(response.error || 'Background script returned an error');
    }
    return response;
  } catch (error: any) {
     // This catches errors like the background script not being available
     console.error(`Error sending message to background: ${message.type}`, error);
     throw new Error(error.message);
  }
}

async function runReconChecks(domain: string, wordlist: Wordlist): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fullUrl = `https://${domain}`;
  const checks = JSON.parse(JSON.stringify(wordlist.endpoints));
  const seenFindings = new Set<string>();

  const batchSize = 10;
  for (let i = 0; i < checks.length; i += batchSize) {
    const batch = checks.slice(i, i + batchSize);
    const promises = batch.map(async (check) => {
      
      const response = await sendMessageToBackground<{ status: number, url: string, data: string }>({
          type: 'CHECK_URL',
          url: `${fullUrl}${check.path}`
      }).catch(() => null); // If message sending fails, treat as a failed check

      if (response) {
        const text = response.data;
        const lowerText = text.toLowerCase();

        const isPositiveMatch = check.positive_match.some((keyword) =>
          lowerText.includes(keyword.toLowerCase())
        );

        if (isPositiveMatch) {
          const isFalsePositive = check.false_positive_indicators.some((keyword) =>
            lowerText.includes(keyword.toLowerCase())
          );

          if (!isFalsePositive) {
            const severity = check.severity.charAt(0).toUpperCase() + check.severity.slice(1);
            const type = check.type === 'directory' ? 'Directory Listing' : 'Sensitive File';
            const findingKey = `${check.path}:${type}`;

            if (!seenFindings.has(findingKey)) {
              seenFindings.add(findingKey);
              return {
                path: check.path,
                severity: severity,
                type: type,
                details: check.description,
              };
            }
          }
        }
      }
      return null;
    });

    const batchResults = await Promise.all(promises);
    findings.push(...batchResults.filter((r): r is Finding => r !== null));
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
  try {
    const domainsToScan = new Map<string, string | null>();
    const SUBDOMAIN_THRESHOLD = 50;

    const rootDomain = getRootDomain(input.domain);
    domainsToScan.set(rootDomain, null);

    let rawData: any = null;

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
          if (subdomains.length > SUBDOMAIN_THRESHOLD) {
            subdomains = subdomains.slice(0, SUBDOMAIN_THRESHOLD);
          }

          subdomains.forEach((subdomain: string) => {
            const name = subdomain.toLowerCase();
            if (!isExcludedSubdomain(name) && !domainsToScan.has(name)) {
              domainsToScan.set(name, null);
            }
          });
        }
      } catch (error) {
        console.warn('Subdomain fetch failed, proceeding with root domain scan:', error);
      }
    }

    // Add the user-provided domain if it's different from the root and not already in the list
    if (input.domain !== rootDomain && !domainsToScan.has(input.domain)) {
      domainsToScan.set(input.domain, null);
    }

    const scanPromises = Array.from(domainsToScan.keys()).map(
      async (domain) => {
        // First check if the domain is live at all
        const liveCheckResponse = await sendMessageToBackground({ type: 'CHECK_URL', url: `https://${domain}` }).catch(() => null);

        if (liveCheckResponse) {
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
        // If the initial check fails, we still want to report on it as unscanned.
        return { domain, status: 'Scanned', ip: null, findings: [] };
      }
    );

    const results = (await Promise.all(scanPromises)).filter(
      (r): r is ScanResult => r !== null
    );

    // Only fail if absolutely no domains (including subdomains) could be processed.
    if (results.length === 0) {
      throw new Error(`No domains found for ${rootDomain}. Check the domain and API key.`);
    }

    return { results, rawData };
  } catch (error: any) {
    console.error('Scan error:', error);
    throw error;
  }
}
