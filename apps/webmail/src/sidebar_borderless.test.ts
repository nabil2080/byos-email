import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runSidebarBorderlessTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Sidebar Borderless Tests...");

  await test("test_sidebar_has_no_border", () => {
    const sidebarPath = path.resolve(__dirname, "components/Sidebar.tsx");
    const source = fs.readFileSync(sidebarPath, "utf-8");

    // Match the aside root element opening tag
    const asideMatch = source.match(/<aside[^>]+class=\{`([^`]+)`\}/);
    assert(asideMatch !== null, "Sidebar.tsx has <aside class={`...`}>");

    const asideClasses = asideMatch![1];
    assert(!/\bborder-r\b/.test(asideClasses), "Sidebar <aside> must not contain 'border-r'");
    assert(!/\bborder-l\b/.test(asideClasses), "Sidebar <aside> must not contain 'border-l'");
    assert(!/\bborder\b/.test(asideClasses), "Sidebar <aside> must not contain standalone 'border'");
  });

  await test("test_sidebar_and_main_share_background", () => {
    const sidebarPath = path.resolve(__dirname, "components/Sidebar.tsx");
    const appPath = path.resolve(__dirname, "App.tsx");
    const sidebarSource = fs.readFileSync(sidebarPath, "utf-8");
    const appSource = fs.readFileSync(appPath, "utf-8");

    const asideMatch = sidebarSource.match(/<aside[^>]+class=\{`([^`]+)`\}/);
    assert(asideMatch !== null, "Sidebar.tsx has <aside class={`...`}>");
    const asideClasses = asideMatch![1];

    const mainMatch = appSource.match(/<main[^>]+class="([^"]+)"/);
    assert(mainMatch !== null, "App.tsx has <main class=\"...\">");
    const mainClasses = mainMatch![1];

    // Both must use Cloud Dancer Light canvas in light mode
    assert(asideClasses.includes("bg-[#F0EEE9]"), "Sidebar uses canvas #F0EEE9 in light mode");
    assert(mainClasses.includes("bg-[#F0EEE9]"), "Main content area uses canvas #F0EEE9 in light mode");

    // Both must use the same dark mode background #18191D
    assert(asideClasses.includes("dark:bg-[#18191D]"), "Sidebar uses #18191D in dark mode");
    assert(mainClasses.includes("dark:bg-[#18191D]"), "Main content area uses #18191D in dark mode");
  });

  return { passed, failed };
}
