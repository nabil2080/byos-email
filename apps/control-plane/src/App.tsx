import { Component, JSX } from "solid-js";
import { Router, Route } from "@solidjs/router";
import AuthGuard from "./components/AuthGuard";
import DashboardLayout from "./components/layout/DashboardLayout";
import DashboardOverview from "./routes/dashboard";
import DomainsPage from "./routes/dashboard/domains";
import MailboxesPage from "./routes/dashboard/mailboxes";
import StoragePage from "./routes/dashboard/storage";
import BillingPage from "./routes/dashboard/billing";
import SettingsPage from "./routes/dashboard/settings";
import MembersPage from "./routes/dashboard/members";
import RecoveryPage from "./routes/dashboard/recovery";
import SecurityPage from "./routes/dashboard/security";
import LoginPage from "./routes/login";
import RegisterPage from "./routes/register";

const ProtectedDashboard: Component<{ children?: JSX.Element }> = (props) => (
  <AuthGuard>
    <DashboardLayout>{props.children}</DashboardLayout>
  </AuthGuard>
);

const App: Component = () => {
  return (
    <Router>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/dashboard" component={ProtectedDashboard}>
        <Route path="/" component={DashboardOverview} />
        <Route path="/domains" component={DomainsPage} />
        <Route path="/mailboxes" component={MailboxesPage} />
        <Route path="/storage" component={StoragePage} />
        <Route path="/billing" component={BillingPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/members" component={MembersPage} />
        <Route path="/recovery" component={RecoveryPage} />
        <Route path="/security" component={SecurityPage} />
      </Route>
      {/* Fallback: redirect root to dashboard */}
      <Route path="/" component={() => { window.location.replace("/dashboard"); return null; }} />
    </Router>
  );
};

export default App;
