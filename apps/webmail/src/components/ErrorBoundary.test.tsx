import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { AppErrorBoundary } from "./ErrorBoundary";
import { createSignal } from "solid-js";

describe("AppErrorBoundary", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders children when no error occurs", () => {
    const { getByText } = render(() => (
      <AppErrorBoundary name="TestModule">
        <div>Safe Child Content</div>
      </AppErrorBoundary>
    ));

    expect(getByText("Safe Child Content")).toBeInTheDocument();
  });

  it("catches error and renders fallback error UI", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const FaultyComponent = () => {
      throw new Error("Simulated component failure");
    };

    render(() => (
      <AppErrorBoundary name="NotesModule">
        <FaultyComponent />
      </AppErrorBoundary>
    ));

    const boundary = screen.getByTestId("app-error-boundary");
    expect(boundary).toBeInTheDocument();
    expect(boundary.textContent).toContain("NotesModule encountered a problem");
    expect(boundary.textContent).toContain("Try Again");
    expect(boundary.textContent).toContain("Technical Details");

    const detailsBtn = screen.getByText("Technical Details");
    fireEvent.click(detailsBtn);

    expect(boundary.textContent).toContain("Simulated component failure");

    spy.mockRestore();
  });

  it("handles custom fallbackTitle and onReset trigger", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onResetMock = vi.fn();

    const [hasError, setHasError] = createSignal(true);

    const FlakyComponent = () => {
      if (hasError()) {
        throw new Error("Flaky error");
      }
      return <div>Recovered Content</div>;
    };

    render(() => (
      <AppErrorBoundary
        fallbackTitle="Custom Error Headline"
        onReset={() => {
          onResetMock();
          setHasError(false);
        }}
      >
        <FlakyComponent />
      </AppErrorBoundary>
    ));

    expect(screen.getByText("Custom Error Headline")).toBeInTheDocument();

    const retryBtn = screen.getByText("Try Again");
    fireEvent.click(retryBtn);

    expect(onResetMock).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
