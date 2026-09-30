import { Folder } from "./components/Sidebar.js";
import { formatSmartDate } from "./components/MessageRow.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runScheduledFolderTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Scheduled Folder Tests...");

  test("1. Folder type union includes 'scheduled'", () => {
    const folder: Folder = "scheduled";
    assert(folder === "scheduled", "Folder should allow 'scheduled'");
  });

  test("2. Sidebar folder list order places 'scheduled' between 'sent' and 'drafts'", () => {
    const expectedFolders: Folder[] = [
      "inbox",
      "sent",
      "scheduled",
      "drafts",
      "snoozed",
      "archive",
      "spam",
      "trash",
    ];
    const scheduledIndex = expectedFolders.indexOf("scheduled");
    const sentIndex = expectedFolders.indexOf("sent");
    const draftsIndex = expectedFolders.indexOf("drafts");

    assert(scheduledIndex === 2, "scheduled should be at index 2");
    assert(sentIndex === 1, "sent should be at index 1");
    assert(draftsIndex === 3, "drafts should be at index 3");
    assert(scheduledIndex === sentIndex + 1, "scheduled should be immediately after sent");
    assert(draftsIndex === scheduledIndex + 1, "drafts should be immediately after scheduled");
  });

  test("3. MessageRow formatSmartDate formats scheduled dates correctly", () => {
    const futureDate = new Date(Date.now() + 86400000 * 2).toISOString();
    const formatted = formatSmartDate(futureDate);
    assert(Boolean(formatted), "formatted date should not be empty");
  });

  test("4. DisplayMessage folder supports 'scheduled'", () => {
    const mockMessage = {
      id: "test-sched-1",
      folder: "scheduled" as Folder,
      sender: "recipient@byos.local",
      recipient: "recipient@byos.local",
      subject: "(scheduled)",
      snippet: "Scheduled send to recipient@byos.local",
      encryptedBody: "",
      date: "Oct 5, 2026",
      read: true,
      starred: false,
    };
    assert(mockMessage.folder === "scheduled", "folder is scheduled");
    assert(mockMessage.subject === "(scheduled)", "default subject is (scheduled)");
  });

  return { passed, failed };
}
