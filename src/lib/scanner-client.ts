import { browser } from '#imports';
import { Wordlist, ScanResult, ScanOutput, Finding } from './types';

async function sendMessageToBackground<T = any>(message: any): Promise<T> {
  const response = await browser.runtime.sendMessage(message);
  if (response.success === false) { // Explicitly check for false
    throw new Error(response.error || 'Background script returned an error');
  }
  return response;
}


async function checkUrl(url: string, originalPath: string): Promise<Response | null> {
  try {
    const response = await sendMessageToBackground<{ status: number, headers: Record<string, string>, data: string }>({
      type: 'CHECK_URL',
      url: url
    });

    // Handle redirects by checking the 'location' header from the manual fetch
    const location = response.headers['location'] || response.headers['Location'];
    if (location) {
      try {
        const finalUrl = new URL(location, url); // Resolve relative URLs
        if (finalUrl.pathname.replace(/\/$/, '') !== originalPath.replace(/\/$/, '')) {
          return null; // Redirected to a different path
        }
      } catch (e) {
        return null; // Invalid redirect URL
      }
    }

    // Reconstruct a Response-like object to maintain interface consistency
    return new Response(response.data, {
      status: response.status,
      headers: new Headers(response.headers)
    });
  } catch (error) {
    console.error(`Error in checkUrl via background script for ${url}:`, error);
    return null;
  }
}

async function runReconChecks(domain: string, wordlist: Wordlist): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fullUrl = `https://${domain}`;
  const checks = JSON.parse(JSON.stringify(wordlist.endpoints));
  const seenFindings = new Set<string>();

  // Fisher-Yates shuffle
  for (let i = checks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [checks[i], checks[j]] = [checks[j], checks[i]];
  }

  const batchSize = 10;
  for (let i = 0; i < checks.length; i += batchSize) {
    const batch = checks.slice(i, i + batchSize);
    const promises = batch.map(async (check) => {
      const res = await checkUrl(`${fullUrl}${check.path}`, check.path);
      if (res && res.ok) {
        const text = await res.text();
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
          let subdomains = response.data.response.domains;
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
        // Don't re-throw, allow the scan to continue with the root domain
      }
    }

    if (input.domain !== rootDomain && !domainsToScan.has(input.domain)) {
      domainsToScan.set(input.domain, null);
    }

    const scanPromises = Array.from(domainsToScan.keys()).map(
      async (domain) => {
        const liveCheckResponse = await checkUrl(`https://${domain}`, '/');
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
            else status = 'Scanned';
          }
          return { domain, status, ip: null, findings };
        }
        return null;
      }
    );

    const results = (await Promise.all(scanPromises)).filter(
      (r): r is ScanResult => r !== null
    );

    if (results.length === 0) {
      throw new Error(`No live domains found for ${rootDomain}. The host may be down or blocking requests.`);
    }

    return { results, rawData };
  } catch (error: any) {
    console.error('Scan error:', error);
    throw error; // Re-throw to be caught by the UI layer
  }
}
