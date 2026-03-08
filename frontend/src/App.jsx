import { useState } from "react";
import Login    from "./pages/Login";
import Setup    from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import Settings  from "./pages/Settings";

export default function App() {
  const [page,          setPage]          = useState("login");
  const [sessionToken,  setSessionToken]  = useState(null);
  const [logoutMessage, setLogoutMessage] = useState("");

  const handleLoginSuccess = (token) => {
    setSessionToken(token);
    setLogoutMessage("");
    setPage("dashboard");
  };

  const handleLogout = (reason) => {
    setSessionToken(null);
    setLogoutMessage(reason || "");
    setPage("login");
  };

  return (
    <>
      {page === "login" && (
        <Login
          onSuccess={handleLoginSuccess}
          onGoSetup={() => { setLogoutMessage(""); setPage("setup"); }}
          logoutMessage={logoutMessage}
        />
      )}
      {page === "setup" && (
        <Setup
          onSuccess={() => setPage("login")}
          onGoLogin={() => { setLogoutMessage(""); setPage("login"); }}
        />
      )}
      {page === "dashboard" && (
        <Dashboard
          token={sessionToken}
          onLogout={handleLogout}
          onSettings={() => setPage("settings")}
        />
      )}
      {page === "settings" && (
        <Settings
          token={sessionToken}
          onBack={(reason) => {
            if (reason === "deleted") {
              setSessionToken(null);
              setLogoutMessage("Account deleted — goodbye.");
              setPage("login");
            } else {
              setPage("dashboard");
            }
          }}
        />
      )}
    </>
  );
}