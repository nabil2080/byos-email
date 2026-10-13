/**
 * Code highlighting utility.
 * Dynamically lazy-loads highlight.js only when pre/code elements exist in the DOM.
 */
export async function highlightCodeBlocks(container: HTMLElement | null | undefined): Promise<void> {
  if (!container) return;
  const codeBlocks = container.querySelectorAll("pre code");
  if (codeBlocks.length === 0) return;

  try {
    const hljsModule = await import("highlight.js");
    const hljs = hljsModule.default || hljsModule;
    codeBlocks.forEach((block) => {
      if (block.getAttribute("data-highlighted")) return;
      hljs.highlightElement(block as HTMLElement);
      block.setAttribute("data-highlighted", "true");
    });
  } catch (err) {
    console.warn("Failed to highlight code blocks:", err);
  }
}
