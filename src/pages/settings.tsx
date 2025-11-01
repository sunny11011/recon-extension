import React, { useState, useEffect, useCallback } from "react";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useToast } from "../hooks/use-toast";
import { browser } from "#imports";
import { browserStorage } from "../lib/storage";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { useScanHistory } from "../hooks/use-scan-history";
import { getRootDomain } from "../lib/scanner-client";
import defaultWordlistData from "../lib/wordlists.json";
import { ExternalLink, Trash2 } from "lucide-react";

function SettingsPage() {
  const [viewdnsApiKey, setViewdnsApiKey] = useState("");
  const [wordlist, setWordlist] = useState("");
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { ignoredDomains, addIgnoredDomain, removeIgnoredDomain } = useScanHistory();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [apiKey, autoScan, savedWordlist] = await Promise.all([
          browserStorage.get<string>("viewdns-key"),
          browserStorage.get<boolean>("auto-scan-enabled"),
          browserStorage.get<any>("wordlist"),
        ]);

        setViewdnsApiKey(apiKey || "");
        setAutoScanEnabled(autoScan || false);
        setWordlist(
          savedWordlist ? JSON.stringify(savedWordlist, null, 2) : JSON.stringify(defaultWordlistData, null, 2)
        );
      } catch (error) {
        console.error("Error loading settings:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load settings",
        });
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [toast]);

  const handleAutoScanChange = async (checked: boolean) => {
    try {
      setAutoScanEnabled(checked);
      await browserStorage.set("auto-scan-enabled", checked);
      toast({
        title: `Auto-scan ${checked ? "enabled" : "disabled"}`,
      });
    } catch (error) {
      console.error("Error saving auto-scan setting:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save auto-scan setting",
      });
    }
  };

  const handleSaveApiKeys = async () => {
    try {
      await browserStorage.set("viewdns-key", viewdnsApiKey);
      toast({
        title: "API Key Saved",
        description: "Your ViewDNS API key has been saved successfully.",
      });
    } catch (error) {
      console.error("Error saving API key:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save API key",
      });
    }
  };

  const handleSaveWordlist = async () => {
    try {
      const parsed = JSON.parse(wordlist);
      await browserStorage.set("wordlist", parsed);
      toast({
        title: "Wordlist Saved",
        description:
          "Your custom wordlist has been saved to extension storage.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Invalid JSON",
        description: "The wordlist is not valid JSON. Please correct it.",
      });
    }
  };
  
  const handleRestoreDefaultWordlist = async () => {
    try {
      await browserStorage.set("wordlist", defaultWordlistData);
      setWordlist(JSON.stringify(defaultWordlistData, null, 2));
      toast({
        title: "Wordlist Restored",
        description: "The default wordlist has been restored.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not restore the default wordlist.",
      });
    }
  };


  const handleIgnoreCurrentDomain = async () => {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0] && tabs[0].url) {
        const rootDomain = getRootDomain(tabs[0].url);
        if (rootDomain) {
          addIgnoredDomain(rootDomain);
          toast({
            title: "Domain Ignored",
            description: `${rootDomain} has been added to the ignore list.`,
          });
        }
      }
    } catch (error) {
      console.error('Failed to get current tab:', error)
    }
  };

  if (isLoading) {
    return <div className="p-4">Loading settings...</div>;
  }

  return (
    <div className="flex flex-col h-full w-full p-4 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            Manage general application settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="autoscan-switch" className="text-base">
                Auto-scan Tabs
              </Label>
              <p className="text-sm text-muted-foreground">
                Automatically scan domains of newly opened tabs.
              </p>
            </div>
            <Switch
              id="autoscan-switch"
              checked={autoScanEnabled}
              onCheckedChange={handleAutoScanChange}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ignored Domains</CardTitle>
          <CardDescription>
            Domains in this list will not be scanned automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleIgnoreCurrentDomain} className="w-full">
            Ignore Current Domain
          </Button>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {ignoredDomains.length > 0 ? (
              ignoredDomains.map((domain) => (
                <div
                  key={domain}
                  className="flex items-center justify-between p-2 border rounded-lg"
                >
                  <span className="font-mono text-sm">{domain}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeIgnoredDomain(domain)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center p-4">
                The ignore list is empty.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Provide API keys for services to improve subdomain enumeration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="viewdns-api">ViewDNS API Key</Label>
              <a
                href="https://viewdns.info/api/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
              >
                Get Key <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Input
              id="viewdns-api"
              type="password"
              placeholder="Your ViewDNS API Key"
              value={viewdnsApiKey}
              onChange={(e) => setViewdnsApiKey(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveApiKeys}>Save API Keys</Button>
          </div>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible className="w-full">
        <Card>
          <AccordionItem value="wordlists" className="border-b-0">
            <AccordionTrigger className="p-6 w-full">
              <div className="flex flex-col space-y-1.5 text-left">
                <CardTitle>Wordlists</CardTitle>
                <CardDescription>
                  Edit the JSON wordlist used for directory and file
                  enumeration.
                </CardDescription>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <CardContent className="space-y-4">
                <Textarea
                  value={wordlist}
                  onChange={(e) => setWordlist(e.target.value)}
                  rows={15}
                  className="font-mono text-xs"
                />
                <div className="flex justify-end gap-2">
                   <Button variant="outline" onClick={handleRestoreDefaultWordlist}>Restore Default</Button>
                  <Button onClick={handleSaveWordlist}>Save Wordlist</Button>
                </div>
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Card>
      </Accordion>
    </div>
  );
}

export default SettingsPage;
