import React from "react";
import ReactDOM from "react-dom/client";
import WealthVitalityDashboard, { normalizeData, readLocalData, clearLocalData } from "./App.jsx";
import { CloudGate, LocalOnlyBadge, cloudConfigured } from "./CloudSync.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {cloudConfigured ? (
      <CloudGate normalize={normalizeData} readLocal={readLocalData} clearLocal={clearLocalData}>
        {(cloud) => <WealthVitalityDashboard cloud={cloud} />}
      </CloudGate>
    ) : (
      <>
        <WealthVitalityDashboard />
        <LocalOnlyBadge />
      </>
    )}
  </React.StrictMode>
);
