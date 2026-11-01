import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { ComposeDrawer } from "./ComposeDrawer";
import type { AttachmentItem } from "../api";
import { validateAttachmentSendReadiness } from "../attachment_upload_pipeline";

// Mock child components that rely on full DOM editor environments
vi.mock("./RichTextEditor", () => ({
  RichTextEditor: () => <div data-testid="mock-editor">Editor</div>,
}));

vi.mock("./RecipientInput", () => ({
  RecipientInput: (props: any) => (
    <input
      data-testid="mock-recipient-input"
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  ),
}));

describe("ComposeDrawer Attachment Experience", () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    to: "test@byos.local",
    onToChange: vi.fn(),
    subject: "Test Subject",
    onSubjectChange: vi.fn(),
    body: "Hello world",
    onBodyChange: vi.fn(),
    scheduledTime: "",
    onScheduledTimeChange: vi.fn(),
    onSend: vi.fn(),
    onSaveDraft: vi.fn(),
    status: null,
    errorMessage: null,
    isEditingDraft: false,
    senderAddress: "sender@byos.local",
    onAttachmentSelected: vi.fn(),
    onRemoveAttachment: vi.fn(),
  };

  it("renders upload progress and cancel button for uploading attachments", () => {
    const uploadingAtt: AttachmentItem = {
      id: "att-1",
      mailbox_id: "box-1",
      filename: "presentation.pdf",
      content_type: "application/pdf",
      size_bytes: 2048 * 1024,
      encrypted: true,
      created_at: new Date().toISOString(),
      uploadStatus: "uploading",
      uploadProgress: {
        completedBytes: 1024 * 1024,
        totalBytes: 2048 * 1024,
        completedChunks: 1,
        totalChunks: 2,
        percent: 50,
      },
    };

    const onCancelAttachment = vi.fn();

    render(() => (
      <ComposeDrawer
        {...baseProps}
        attachments={[uploadingAtt]}
        onCancelAttachment={onCancelAttachment}
      />
    ));

    // Checks filename and byte progress indicator
    expect(screen.getByText("presentation.pdf")).toBeDefined();
    expect(screen.getByText("1.0 MB/2.0 MB (50%)")).toBeDefined();

    // Cancel button should be rendered while uploading
    const cancelBtn = screen.getByTestId("cancel-attachment-upload");
    expect(cancelBtn).toBeDefined();

    fireEvent.click(cancelBtn);
    expect(onCancelAttachment).toHaveBeenCalledWith("att-1");
  });

  it("renders failed state with error message and retry button", () => {
    const failedAtt: AttachmentItem = {
      id: "att-2",
      mailbox_id: "box-1",
      filename: "large_data.zip",
      content_type: "application/zip",
      size_bytes: 1024 * 1024,
      encrypted: true,
      created_at: new Date().toISOString(),
      uploadStatus: "failed",
      uploadError: "HTTP 502 Bad Gateway",
    };

    const onRetryAttachment = vi.fn();

    render(() => (
      <ComposeDrawer
        {...baseProps}
        attachments={[failedAtt]}
        onRetryAttachment={onRetryAttachment}
      />
    ));

    expect(screen.getByText("large_data.zip")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("HTTP 502 Bad Gateway")).toBeDefined();

    // Retry button should be visible
    const retryBtn = screen.getByTestId("retry-attachment-upload");
    expect(retryBtn).toBeDefined();

    fireEvent.click(retryBtn);
    expect(onRetryAttachment).toHaveBeenCalledWith("att-2");
  });

  it("renders aggregate progress banner and supports Cancel All", () => {
    const atts: AttachmentItem[] = [
      {
        id: "att-1",
        mailbox_id: "box-1",
        filename: "file1.pdf",
        content_type: "application/pdf",
        size_bytes: 1024 * 1024,
        encrypted: true,
        created_at: new Date().toISOString(),
        uploadStatus: "uploading",
        uploadProgress: {
          completedBytes: 512 * 1024,
          totalBytes: 1024 * 1024,
          completedChunks: 1,
          totalChunks: 2,
          percent: 50,
        },
      },
      {
        id: "att-2",
        mailbox_id: "box-1",
        filename: "file2.pdf",
        content_type: "application/pdf",
        size_bytes: 2048 * 1024,
        encrypted: true,
        created_at: new Date().toISOString(),
        uploadStatus: "uploading",
        uploadProgress: {
          completedBytes: 1024 * 1024,
          totalBytes: 2048 * 1024,
          completedChunks: 1,
          totalChunks: 2,
          percent: 50,
        },
      },
    ];

    const onCancelAllUploads = vi.fn();

    render(() => (
      <ComposeDrawer
        {...baseProps}
        attachments={atts}
        onCancelAllUploads={onCancelAllUploads}
      />
    ));

    // Aggregate banner must be visible with byte total
    const banner = screen.getByTestId("aggregate-upload-banner");
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain("Uploading 2 files");
    expect(banner.textContent).toContain("1.5 MB / 3.0 MB, 50%");

    // Cancel All button
    const cancelAllBtn = screen.getByTestId("cancel-all-uploads");
    expect(cancelAllBtn).toBeDefined();

    fireEvent.click(cancelAllBtn);
    expect(onCancelAllUploads).toHaveBeenCalled();
  });

  it("disables send button when attachments are uploading, failed, or cancelled", () => {
    const uploadingAtt: AttachmentItem = {
      id: "att-1",
      mailbox_id: "box-1",
      filename: "uploading.bin",
      content_type: "application/octet-stream",
      size_bytes: 1024,
      encrypted: true,
      created_at: new Date().toISOString(),
      uploadStatus: "uploading",
      uploadProgress: {
        completedBytes: 0,
        totalBytes: 1024,
        completedChunks: 0,
        totalChunks: 1,
        percent: 0,
      },
    };

    const { unmount } = render(() => (
      <ComposeDrawer {...baseProps} attachments={[uploadingAtt]} />
    ));

    const sendBtn = screen.getByTestId("compose-send-btn") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.textContent).toContain("Uploading Attachments…");

    unmount();

    // Test with cancelled attachment: must block send until removed or retried
    const cancelledAtt: AttachmentItem = {
      id: "att-cancelled",
      mailbox_id: "box-1",
      filename: "cancelled.bin",
      content_type: "application/octet-stream",
      size_bytes: 1024,
      encrypted: true,
      created_at: new Date().toISOString(),
      uploadStatus: "cancelled",
    };

    const { unmount: unmountCancelled } = render(() => (
      <ComposeDrawer {...baseProps} attachments={[cancelledAtt]} />
    ));

    const cancelledSendBtn = screen.getByTestId("compose-send-btn") as HTMLButtonElement;
    expect(cancelledSendBtn.disabled).toBe(true);
    expect(cancelledSendBtn.title).toContain("was cancelled");

    unmountCancelled();

    // Now test with completed attachment
    const completedAtt: AttachmentItem = {
      id: "att-completed",
      mailbox_id: "box-1",
      filename: "ready.txt",
      content_type: "text/plain",
      size_bytes: 500,
      encrypted: true,
      created_at: new Date().toISOString(),
      uploadStatus: "completed",
    };

    render(() => (
      <ComposeDrawer {...baseProps} attachments={[completedAtt]} />
    ));

    const enabledSendBtn = screen.getByTestId("compose-send-btn") as HTMLButtonElement;
    expect(enabledSendBtn.disabled).toBe(false);
    expect(enabledSendBtn.textContent).toContain("Send Encrypted");
  });

  it("validates centralized send readiness across all lifecycle states", () => {
    // 1. In-flight states
    expect(
      validateAttachmentSendReadiness([
        { id: "1", filename: "a.txt", uploadStatus: "preparing" },
      ]).canSend,
    ).toBe(false);

    expect(
      validateAttachmentSendReadiness([
        { id: "1", filename: "a.txt", uploadStatus: "encrypting" },
      ]).canSend,
    ).toBe(false);

    expect(
      validateAttachmentSendReadiness([
        { id: "1", filename: "a.txt", uploadStatus: "uploading" },
      ]).canSend,
    ).toBe(false);

    // 2. Failed state
    const failedRes = validateAttachmentSendReadiness([
      { id: "1", filename: "a.txt", uploadStatus: "failed", uploadError: "Network error" },
    ]);
    expect(failedRes.canSend).toBe(false);
    expect(failedRes.reason).toContain("failed to upload: Network error");

    // 3. Cancelled state
    const cancelledRes = validateAttachmentSendReadiness([
      { id: "1", filename: "a.txt", uploadStatus: "cancelled" },
    ]);
    expect(cancelledRes.canSend).toBe(false);
    expect(cancelledRes.reason).toContain("was cancelled");

    // 4. Duplicate ID
    const dupRes = validateAttachmentSendReadiness([
      { id: "1", filename: "a.txt", uploadStatus: "completed" },
      { id: "1", filename: "a_copy.txt", uploadStatus: "completed" },
    ]);
    expect(dupRes.canSend).toBe(false);
    expect(dupRes.reason).toContain("Duplicate attachment detected");

    // 5. Existing draft attachment (encrypted=true, no explicit uploadStatus)
    const draftRes = validateAttachmentSendReadiness([
      { id: "draft-att-1", filename: "invoice.pdf", encrypted: true },
    ]);
    expect(draftRes.canSend).toBe(true);
    expect(draftRes.validAttachments.length).toBe(1);

    // 6. Mixed: one completed, one failed -> must block
    const mixedRes = validateAttachmentSendReadiness([
      { id: "1", filename: "good.pdf", uploadStatus: "completed" },
      { id: "2", filename: "bad.pdf", uploadStatus: "failed" },
    ]);
    expect(mixedRes.canSend).toBe(false);

    // 7. All completed -> permitted
    const allGoodRes = validateAttachmentSendReadiness([
      { id: "1", filename: "good1.pdf", uploadStatus: "completed" },
      { id: "2", filename: "good2.pdf", uploadStatus: "completed" },
    ]);
    expect(allGoodRes.canSend).toBe(true);
    expect(allGoodRes.validAttachments.length).toBe(2);
  });
});
