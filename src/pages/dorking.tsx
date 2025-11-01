import React from 'react';
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { ExternalLink } from 'lucide-react';

const dorks = [
  {
    title: "Directory Listing",
    query: 'site:{domain} intitle:"index of"',
    description: "Finds servers with directory listing enabled.",
  },
  {
    title: "Configuration Files",
    query: 'site:{domain} ext:xml | ext:conf | ext:cnf | ext:reg | ext:inf | ext:rdp | ext:cfg | ext:txt | ext:ora | ext:ini | ext:env',
    description: "Locates configuration files.",
  },
  {
    title: "Database Files",
    query: 'site:{domain} ext:sql | ext:dbf | ext:mdb',
    description: "Finds database files.",
  },
  {
    title: "Log Files",
    query: 'site:{domain} ext:log',
    description: "Finds log files with potential sensitive info.",
  },
  {
    title: "Backup and Old Files",
    query: 'site:{domain} ext:bkf | ext:bkp | ext:bak | ext:old | ext:backup',
    description: "Finds backup and old files.",
  },
  {
    title: "Login Pages",
    query: 'site:{domain} inurl:login | inurl:signin | intitle:Login | intitle:Sign in',
    description: "Finds login portals.",
  },
  {
    title: "SQL Errors",
    query: 'site:{domain} intext:"sql syntax near" | intext:"syntax error has occurred" | intext:"incorrect syntax near" | intext:"unexpected end of SQL command" | intext:"Warning: mysql_connect()" | intext:"Warning: mysql_query()" | intext:"Warning: pg_connect()"',
    description: "Finds pages with SQL error messages.",
  },
  {
    title: "Publicly Exposed Documents",
    query: 'site:{domain} ext:doc | ext:docx | ext:odt | ext:pdf | ext:rtf | ext:sxw | ext:psw | ext:ppt | ext:pptx | ext:pps | ext:csv',
    description: "Finds documents that may have been exposed.",
  },
  {
    title: "Find Subdomains",
    query: 'site:*.{domain}',
    description: "Lists all indexed subdomains.",
  },
];

const DorkingCard = ({ title, query, description }: { title: string, query: string, description: string }) => {
  const handleDork = async () => {
    let domain = "example.com";
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].url) {
        const url = new URL(tabs[0].url);
        domain = url.hostname;
      }
    } catch (e) {
      console.error("Could not get current tab URL:", e);
    }
    
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query.replace('{domain}', domain))}`;
    window.open(googleUrl, '_blank');
  };

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg transition-colors hover:bg-muted/50">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
        <code className="text-xs font-code text-primary bg-primary/10 px-1 py-0.5 rounded-sm mt-1 inline-block">{query}</code>
      </div>
      <Button aria-label={`Run dork: ${title}`} variant="ghost" size="icon" onClick={handleDork}>
        <ExternalLink className="h-4 w-4" />
      </Button>
    </div>
  )
}

function DorkingPage() {
  return (
    <div className="flex flex-col h-full w-full p-4">
      <Card>
        <CardHeader>
          <CardTitle>Dorking Cheatsheet</CardTitle>
          <CardDescription>
            One-click Google Dork queries for the target domain. The current domain will be automatically used.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {dorks.map((dork) => (
            <DorkingCard key={dork.title} {...dork} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export default DorkingPage;
