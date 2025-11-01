export interface Finding {
  path: string;
  severity: string;
  type: string;
  details: string;
}

export interface ScanResult {
  domain: string;
  status: 'Vulnerable' | 'Potentially Vulnerable' | 'Secure' | 'Scanned';
  ip: string | null;
  findings: Finding[];
}

export interface ScanOutput {
    results: ScanResult[];
    rawData: any;
}

export interface Wordlist {
    endpoints: {
        path: string;
        severity: string;
        type: string;
        description: string;
    }[];
}
