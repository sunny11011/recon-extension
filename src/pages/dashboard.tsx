import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { useScanHistory } from "../hooks/use-scan-history";
import { getRootDomain } from "../lib/scanner-client";
import { ScanResult, Finding } from "../lib/types";
import {
  Loader,
  ScanLine,
  Info,
  X,
  ShieldAlert,
  AlertTriangle,
  ShieldCheck,
  Shield,
  ExternalLink,
  ShieldX,
  SkipForward,
} from "lucide-react";

const statusConfig: Record<ScanResult['status'], { icon: React.ElementType; variant: 'destructive' | 'secondary' | 'default' | 'outline'; label: string }> = {
  Vulnerable: {
    icon: ShieldAlert,
    variant: "destructive",
    label: "Vulnerable",
  },
  "Potentially Vulnerable": {
    icon: AlertTriangle,
    variant: "secondary",
    label: "Potential",
  },
  Secure: {
    icon: ShieldCheck,
    variant: "default",
    label: "Secure",
  },
  Scanned: {
    icon: Shield,
    variant: "outline",
    label: "Scanned",
  },
};

const severityConfig: any = {
  Critical: { variant: "destructive", icon: ShieldX },
  High: { variant: "destructive" },
  Medium: { variant: "secondary" },
  Low: { variant: "outline" },
  Info: { variant: "outline" },
};

function FindingDetails({
  domain,
  finding,
}: {
  domain: string;
  finding: Finding;
}) {
  const config = severityConfig[finding.severity] || { variant: "outline" };
  const handleLinkClick = () => {
    const url = new URL(`https://${domain}`);
    url.pathname = finding.path;
    window.open(url.toString(), "_blank");
  };

  return (
    <div className="p-2 space-y-2 border-l-2 ml-2 pl-4 border-dashed">
      <div className="flex justify-between items-start gap-2">
        <p className="font-semibold text-sm flex-grow">
          {finding.type} at{" "}
          <code className="font-mono bg-muted px-1 py-0.5 rounded break-all">
            {finding.path}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-1 inline-flex items-center justify-center"
            onClick={handleLinkClick}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </p>
        <Badge variant={config.variant} className="text-nowrap gap-1.5">
          {config.icon && <config.icon className="h-3 w-3" />}
          {finding.severity}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{finding.details}</p>
    </div>
  );
}

function ResultRow({ result }: { result: ScanResult }) {
  const status = statusConfig[result.status];
  const StatusIcon = status.icon;

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={result.domain} className="border-b-0">
        <AccordionTrigger className="p-4 hover:no-underline [&[data-state=open]]:pb-2 rounded-lg hover:bg-muted/50 transition-colors">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <a
                href={`https://${result.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sm hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {result.domain}
              </a>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant={status.variant} className="gap-1.5 text-xs">
                <StatusIcon className="h-3.5 w-3.5" />
                {status.label}
              </Badge>
              <span className="text-sm w-24 text-right text-muted-foreground">
                {result.findings.length > 0
                  ? `${result.findings.length} finding${
                      result.findings.length > 1 ? "s" : ""
                    }`
                  : "No findings"}
              </span>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4 text-left">
          {result.findings.length > 0 ? (
            <div className="space-y-4 pt-2">
              {result.findings.map((finding, index) => (
                <FindingDetails
                  key={index}
                  domain={result.domain}
                  finding={finding}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No findings for this domain.
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function DashboardPage() {
  const [inputValue, setInputValue] = useState("");
  const {
    sessionResults,
    addScanToQueue,
    isProcessingQueue,
    currentlyScanningDomain,
    skipCurrentScan,
    stopAllScans,
    scanQueue,
    initialQueueLength,
  } = useScanHistory();

  const handleManualScan = () => {
    if (!inputValue) return;
    const domain = inputValue.trim();
    addScanToQueue(domain);
    setInputValue("");
  };

  const groupedResults = sessionResults.reduce((acc, result) => {
    const rootDomain = getRootDomain(result.domain);
    if (!acc[rootDomain]) {
      acc[rootDomain] = [];
    }
    acc[rootDomain].push(result);
    return acc;
  }, {} as Record<string, ScanResult[]>);

  const currentScanIndex = initialQueueLength - scanQueue.length;

  return (
    <div className="flex flex-col h-full w-full p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          placeholder="Enter a domain or subdomain..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleManualScan()}
          disabled={isProcessingQueue}
        />
        <Button
          onClick={handleManualScan}
          disabled={!inputValue || isProcessingQueue}
        >
          {isProcessingQueue && !currentlyScanningDomain ? (
            <Loader className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ScanLine className="mr-2 h-4 w-4" />
          )}
          Scan
        </Button>
      </div>

      {isProcessingQueue && currentlyScanningDomain && (
        <Alert>
          <Info className="h-4 w-4" />
          <div className="flex items-center justify-between w-full">
            <div>
              <AlertTitle>
                Scanning in Progress 
                {initialQueueLength > 1 && ` (${currentScanIndex} of ${initialQueueLength})`}
              </AlertTitle>
              <AlertDescription>
                Currently scanning:{" "}
                <code className="font-semibold">{currentlyScanningDomain}</code>
              </AlertDescription>
            </div>
            <div className="flex items-center gap-1">
              <Loader className="h-4 w-4 animate-spin" />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={skipCurrentScan}
                title="Skip Current Domain"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={stopAllScans}
                title="Stop All Scans"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-xl">Scan Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sessionResults.length > 0 ? (
            <div className="border-t">
              <Accordion type="multiple" className="w-full">
                {Object.entries(groupedResults).map(([rootDomain, results]) => (
                  <AccordionItem key={rootDomain} value={rootDomain}>
                    <div className="flex items-center w-full px-4">
                      <AccordionTrigger className="hover:no-underline flex-grow font-semibold text-base">
                        <div className="flex justify-between items-center w-full">
                          <div className="flex items-center gap-4">
                            <span>{rootDomain}</span>
                            <Badge variant="outline">
                              {results.length} domain
                              {results.length > 1 ? "s" : ""} found
                            </Badge>
                          </div>
                        </div>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent className="px-4 pb-2 space-y-2">
                      {results.map((result) => (
                        <ResultRow key={result.domain} result={result} />
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ) : (
            <div className="text-center text-muted-foreground p-8 border-t">
              {isProcessingQueue ? (
                <p>Waiting for scan results...</p>
              ) : (
                <>
                  <p>No domains scanned in this session yet.</p>
                  <p className="text-sm">
                    Enter a domain above or browse to a new tab to start a scan.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default DashboardPage;
