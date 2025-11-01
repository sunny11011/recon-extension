import { browser } from '#imports';
import { userAgents } from './user-agents';
import { Wordlist, ScanResult, ScanOutput, Finding } from './types';

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

async function checkUrl(url: string, originalPath: string): Promise<Response | null> {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'CHECK_URL',
      url: url
    });

    if (!response.success) {
      return null;
    }

    // Create a Response-like object from background data
    const mockResponse = new Response(response.data, {
      status: response.status,
      headers: new Headers(response.headers)
    });

    // Handle redirects
    if (response.headers.location) {
      try {
        const finalUrl = new URL(response.headers.location);
        if (finalUrl.pathname.replace(/\/$/, '') !== originalPath.replace(/\/$/, '')) {
          return null;
        }
      } catch (e) {
        return null;
      }
    }

    return mockResponse;
  } catch (error) {
    console.error('Check URL error:', error);
    return null;
  }
}

async function runReconChecks(domain: string, wordlist: Wordlist): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fullUrl = `https://${domain}`;
  const checks = JSON.parse(JSON.stringify(wordlist.endpoints));
  const seenFindings = new Set<string>();

  for (let i = checks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [checks[i], checks[j]] = [checks[j], checks[i]];
  }

  const batchSize = 10;
  for (let i = 0; i < checks.length; i += batchSize) {
    const batch = checks.slice(i, i + batchSize);
    const promises = batch.map(async (check: { path: string; positive_match: string[]; false_positive_indicators: string[]; severity: string; type: string; description: any; }) => {
      const res = await checkUrl(`${fullUrl}${check.path}`, check.path);
      if (res && res.ok) {
        const text = await res.text();
        const lowerText = text.toLowerCase();

        const isPositiveMatch = check.positive_match.some((keyword: string) =>
          lowerText.includes(keyword.toLowerCase())
        );

        if (isPositiveMatch) {
          const isFalsePositive = check.false_positive_indicators.some((keyword: string) =>
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
            const commonSLDs = ['co', 'com', 'org', 'net', 'gov', 'edu'];
            if (commonSLDs.includes(sld) && parts.length > 2) {
                return parts.slice(-3).join('.');
            }
            return parts.slice(-2).join('.');
        }
        return url.hostname;
    } catch (e) {
        const parts = domain.split('/')[0].split('.');
         if (parts.length > 2) {
            const sld = parts[parts.length-2];
            const commonSLDs = ['co', 'com', 'org', 'net', 'gov', 'edu'];
             if(commonSLDs.includes(sld) && parts.length > 2){
               return parts.slice(-3).join('.');
            }
           return parts.slice(-2).join('.');
        }
        return domain.split('/')[0];
    }
};

function isExcludedSubdomain(domain: string): boolean {
  const excludePatterns = [
    /^www\./i,
    /^webmail\./i,
    /^mail\./i,
    /^cpanel\./i,
    /^autodiscover\./i,
  ];
  return excludePatterns.some((pattern) => pattern.test(domain));
}

async function sendMessageToBackground(message: any): Promise<any> {
    return browser.runtime.sendMessage(message);
}

export async function performScan(input: {
  domain: string;
  apiKey: string;
  wordlist: Wordlist;
}): Promise<ScanOutput> {
  try {
    const domainsToScan = new Map<string, string | null>();
    const SUBDOMAIN_THRESHOLD = 50;
    let rawData: any = null;

    const rootDomain = getRootDomain(input.domain);
    domainsToScan.set(rootDomain, null);

    if (input.apiKey) {
      try {
        const response = await browser.runtime.sendMessage({
          type: 'FETCH_SUBDOMAINS',
          domain: rootDomain,
          apiKey: input.apiKey
        });

        if (!response.success) {
          throw new Error(response.error || 'Failed to fetch subdomains');
        }
        
        if (response.data?.response?.domains) {
          let subdomains = response.data.response.domains;
          const domainCount = subdomains.length;

          if (domainCount > SUBDOMAIN_THRESHOLD) {
            subdomains = subdomains.filter((sub: { name: string; }) => !/\d/.test(sub.name));
          }

          if (subdomains.length > SUBDOMAIN_THRESHOLD) {
            subdomains = subdomains.slice(0, SUBDOMAIN_THRESHOLD);
          }

          subdomains.forEach((subdomain: any) => {
            const name = subdomain.name.toLowerCase();
            if (!isExcludedSubdomain(name) && !domainsToScan.has(name)) {
              domainsToScan.set(name, null);
            }
          });
        }
      } catch (error: any) {
        console.error('Subdomain fetch error:', error);
        throw new Error(error.message || 'Failed to fetch subdomains.');
      }
    }

    if (input.domain !== rootDomain && !domainsToScan.has(input.domain)) {
      domainsToScan.set(input.domain, null);
    }

    const scanPromises = Array.from(domainsToScan.entries()).map(
      async ([domain, ip]) => {
        const liveCheckResponse = await checkUrl(`https://${domain}`, '/');
        if (liveCheckResponse) {
          const findings = await runReconChecks(domain, input.wordlist);
          let status = 'Secure';

          if (findings.length > 0) {
            const hasCritical = findings.some((f) => f.severity === 'Critical');
            const hasHigh = findings.some((f) => f.severity === 'High');
            const hasMedium = findings.some((f) => f.severity === 'Medium');

            if (hasCritical || hasHigh) {
              status = 'Vulnerable';
            } else if (hasMedium) {
              status = 'Potentially Vulnerable';
            } else {
              status = 'Scanned';
            }
          }
          return { domain, status, ip: ip || null, findings };
        }
        return null;
      }
    );

    const results = (await Promise.all(scanPromises)).filter(
      (r): r is ScanResult => r !== null
    );

    return { results, rawData };
  } catch (error: any) {
    console.error('Scan error:', error);
    throw new Error(error.message || 'An unknown error occurred during the scan.');
  }
}
