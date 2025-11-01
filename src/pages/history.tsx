import React, { useState, useEffect } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { useScanHistory } from '../hooks/use-scan-history';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { ScanResult, Finding } from '../lib/types';
import {
  ShieldAlert,
  AlertTriangle,
  ShieldCheck,
  Shield,
  ShieldX,
  ExternalLink,
  FileDown,
  Trash2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

const statusConfig: any = {
  Vulnerable: {
    icon: ShieldAlert,
    variant: 'destructive',
    label: 'Vulnerable',
  },
  'Potentially Vulnerable': {
    icon: AlertTriangle,
    variant: 'secondary',
    label: 'Potential',
  },
  Secure: {
    icon: ShieldCheck,
    variant: 'default',
    label: 'Secure',
  },
  Scanned: {
    icon: Shield,
    variant: 'outline',
    label: 'Scanned',
  },
};

const severityConfig: any = {
  Critical: { variant: 'destructive', icon: ShieldX },
  High: { variant: 'destructive' },
  Medium: { variant: 'secondary' },
  Low: { variant: 'outline' },
  Info: { variant: 'outline' },
};

function FindingDetails({ domain, finding }: { domain: string; finding: Finding }) {
  const config = severityConfig[finding.severity] || { variant: 'outline' };
  const handleLinkClick = () => {
    const url = new URL(`https://${domain}`);
    url.pathname = finding.path;
    window.open(url.toString(), '_blank');
  };

  return (
    <div className="p-2 space-y-2 border-l-2 ml-2 pl-4 border-dashed">
      <div className="flex justify-between items-start gap-2">
        <p className="font-semibold text-sm flex-grow">
          {finding.type} at{' '}
          <code className="font-code bg-muted px-1 py-0.5 rounded break-all">
            {finding.path}
          </code>
          <button
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleLinkClick}
            aria-label="Open finding URL"
          >
            <ExternalLink className="h-3.5 w-3.5 inline-block ml-1" />
          </button>
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
              {result.ip && (
                <a
                  href={`https://${result.ip}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-4">
              <Badge variant={status.variant} className="gap-1.5 text-xs">
                <StatusIcon className="h-3.5 w-3.5" />
                {status.label}
              </Badge>
              <span className="text-sm w-24 text-right text-muted-foreground">
                {result.findings.length > 0
                  ? `${result.findings.length} finding${
                      result.findings.length > 1 ? 's' : ''
                    }`
                  : 'No findings'}
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

function DomainGroup({ item, exportData }: { item: any, exportData: any }) {
  const { deleteHistoryItem } = useScanHistory();
  const { rootDomain, result: results } = item;

  return (
    <AccordionItem key={rootDomain} value={rootDomain}>
      <div className="flex items-center w-full px-4">
        <AccordionTrigger className="text-lg font-semibold hover:no-underline flex-grow py-4">
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-4">
              <span>{rootDomain}</span>
              <Badge variant="outline">
                {results.length} domain{results.length > 1 ? 's' : ''}
              </Badge>
            </div>
          </div>
        </AccordionTrigger>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            exportData(results, `${rootDomain}_scan.json`, 'json');
          }}
        >
          <FileDown className="h-4 w-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 ml-2 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the scan history for{' '}
                <span className="font-bold">{rootDomain}</span>. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteHistoryItem(rootDomain)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <AccordionContent className="p-2 space-y-2">
        {results.map((result: ScanResult) => (
          <ResultRow key={result.domain} result={result} />
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}

function HistoryPage() {
  const { history } = useScanHistory();
  
  const exportData = (data: any, filename: string, type: 'json' | 'csv') => {
    let dataStr;
    let dataUri;

    if (type === 'json') {
      dataStr = JSON.stringify(data, null, 2);
      dataUri =
        'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    } else {
      const header = [
        'Domain',
        'Status',
        'IP Address',
        'Finding Type',
        'Severity',
        'Path',
        'Details',
      ];
      const rows = data.flatMap((r: ScanResult) => {
        if (r.findings.length === 0) {
          return [[r.domain, r.status, r.ip || 'N/A', 'N/A', 'N/A', 'N/A', 'N/A']];
        }
        return r.findings.map((f: Finding) => [
          r.domain,
          r.status,
          r.ip || 'N/A',
          f.type,
          f.severity,
          f.path,
          `"${f.details.replace(/"/g, '""')}"`,
        ]);
      });
      dataStr = [header.join(','), ...rows.map((row: any) => row.join(','))].join('\n');
      dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(dataStr);
    }

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', filename);
    linkElement.click();
  };

  const groupedByDate = history.reduce((acc, item) => {
    const date = format(parseISO(item.scannedAt), 'MMMM do, yyyy');
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => {
    return (
      parseISO(groupedByDate[b][0].scannedAt).getTime() -
      parseISO(groupedByDate[a][0].scannedAt).getTime()
    );
  });

  if (history.length === 0) {
    return (
      <div className="flex flex-col h-full w-full p-4 items-center justify-center text-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>No History</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Your scan history is empty. Scanned domains from the dashboard
              will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full p-4 space-y-4">
      <h1 className="text-2xl font-bold">Scan History</h1>
      {sortedDates.map((date) => (
        <div key={date}>
          <h2 className="text-lg font-semibold text-muted-foreground px-4 py-2">
            {date}
          </h2>
          <Card>
            <CardContent className="p-0">
              <Accordion type="multiple" className="w-full">
                {groupedByDate[date].map((item) => (
                  <DomainGroup
                    key={item.rootDomain}
                    item={item}
                    exportData={exportData}
                  />
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

export default HistoryPage;
