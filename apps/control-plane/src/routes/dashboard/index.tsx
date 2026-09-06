import { Component } from "solid-js";

const DashboardOverview: Component = () => {
  return (
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-semibold text-slate-900">Dashboard</h1>
      <p class="mt-2 text-sm text-slate-500">Overview placeholder – future dashboard content.</p>
      <p class="mt-4 text-sm">
        <a href="/dashboard/storage" class="text-sky-600 hover:underline">
          Go to Storage
        </a>
      </p>
    </div>
  );
};

export default DashboardOverview;
