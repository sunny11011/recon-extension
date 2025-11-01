import { useState, useEffect } from "react";
import { browser } from "#imports";
import { Toaster } from "./components/ui/toaster";
import { Header } from "./components/header";
import DashboardPage from "./pages/dashboard";
import DorkingPage from "./pages/dorking";
import HistoryPage from "./pages/history";
import SettingsPage from "./pages/settings";
import "./assets/css/tailwind.css";
import { useScanHistory } from "./hooks/use-scan-history";

function App() {
  const [activeView, setActiveView] = useState("Dashboard");
  const { addScanToQueue } = useScanHistory();

  // Check for pending scans when popup opens
  useEffect(() => {
    const checkPendingScan = async () => {
      try {
        const response = await browser.runtime.sendMessage({
          type: "GET_PENDING_SCAN",
        });
        if (response.success && response.domain) {
          addScanToQueue(response.domain);
        }
      } catch (error) {
        console.error("Error checking pending scan:", error);
      }
    };

    checkPendingScan();
  }, []);

  const renderView = () => {
    switch (activeView) {
      case "Dashboard":
        return <DashboardPage />;
      case "Dorking":
        return <DorkingPage />;
      case "History":
        return <HistoryPage />;
      case "Settings":
        return <SettingsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="flex flex-col h-[600px] w-[500px] bg-background">
      <Header activeView={activeView} setActiveView={setActiveView} />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">{renderView()}</div>
      </main>
      <Toaster />
    </div>
  );
}

export default App;
