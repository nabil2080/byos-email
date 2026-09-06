import { Component } from "solid-js";
import { Router, Route } from "@solidjs/router";
import DashboardLayout from "./components/layout/DashboardLayout";
import StoragePage from "./routes/dashboard/storage";
import DashboardOverview from "./routes/dashboard";
import DomainsPage from "./routes/dashboard/domains";
import MailboxesPage from "./routes/dashboard/mailboxes";
import RecoveryPage from "./routes/dashboard/recovery";
import DraftsPage from "./routes/dashboard/drafts";
import ContactsPage from "./routes/dashboard/contacts";
import MembersPage from "./routes/dashboard/members";
import SettingsPage from "./routes/dashboard/settings";
import SearchPage from "./routes/dashboard/search";
import BillingPage from "./routes/dashboard/billing";
import LoginPage from "./routes/login";
import RegisterPage from "./routes/register";

const App: Component = () => {
  return (
    <Router>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/dashboard" component={DashboardLayout}>
        <Route path="/" component={DashboardOverview} />
        <Route path="/storage" component={StoragePage} />
        <Route path="/domains" component={DomainsPage} />
        <Route path="/mailboxes" component={MailboxesPage} />
        <Route path="/recovery" component={RecoveryPage} />
        <Route path="/drafts" component={DraftsPage} />
        <Route path="/contacts" component={ContactsPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/billing" component={BillingPage} />
        <Route path="/members" component={MembersPage} />
        <Route path="/settings" component={SettingsPage} />
      </Route>
      {/* Fallback: redirect root to dashboard */}
      <Route path="/" component={() => { window.location.replace("/dashboard/storage"); return null; }} />
    </Router>
  );
};

export default App;

