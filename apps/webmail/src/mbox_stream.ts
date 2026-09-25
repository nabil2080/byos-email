export interface ParsedMboxMessage {
  raw: string;        // full RFC822 text including headers
  fromLine: string;   // the "From " envelope line (for future folder detection)
}

export const CHUNK_SIZE = 64 * 1024; // 64KB chunk size

/**
 * Streams messages incrementally from an mbox file.
 * Handles CRLF and LF line endings, mboxrd escaping (>From -> From),
 * and supports cancellation via AbortSignal.
 */
export async function* streamMbox(
  file: File | Blob,
  signal?: AbortSignal,
): AsyncGenerator<ParsedMboxMessage> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  let currentFromLine = "";
  let currentMsgLines: string[] = [];
  let hasMessage = false;

  function unescapeMboxrd(line: string): string {
    if (/^>+From /.test(line)) {
      return line.slice(1);
    }
    return line;
  }

  function finalizeCurrentMessage(): ParsedMboxMessage | null {
    if (!hasMessage) return null;

    // Remove single trailing blank separator line if present before next "From "
    while (
      currentMsgLines.length > 0 &&
      (currentMsgLines[currentMsgLines.length - 1] === "\r\n" ||
        currentMsgLines[currentMsgLines.length - 1] === "\n")
    ) {
      currentMsgLines.pop();
    }

    const raw = currentMsgLines.join("");
    return {
      raw,
      fromLine: currentFromLine,
    };
  }

  // Stream reader initialization (supports standard ReadableStream or slice fallback)
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let useSlice = false;

  if (typeof file.stream === "function") {
    try {
      reader = file.stream().getReader();
    } catch {
      useSlice = true;
    }
  } else {
    useSlice = true;
  }

  let sliceOffset = 0;

  try {
    while (true) {
      if (signal?.aborted) return;

      let chunkBytes: Uint8Array | null = null;

      if (!useSlice && reader) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkBytes = value;
      } else {
        if (sliceOffset >= file.size) break;
        const slice = file.slice(sliceOffset, sliceOffset + CHUNK_SIZE);
        sliceOffset += CHUNK_SIZE;
        const ab = await slice.arrayBuffer();
        chunkBytes = new Uint8Array(ab);
      }

      if (!chunkBytes || chunkBytes.length === 0) continue;

      buffer += decoder.decode(chunkBytes, { stream: true });

      // Process complete lines in buffer
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        if (signal?.aborted) return;

        const rawLine = buffer.slice(0, newlineIdx + 1);
        buffer = buffer.slice(newlineIdx + 1);

        let lineEnding = "\n";
        let line = rawLine;
        if (rawLine.endsWith("\r\n")) {
          lineEnding = "\r\n";
          line = rawLine.slice(0, -2);
        } else if (rawLine.endsWith("\n")) {
          lineEnding = "\n";
          line = rawLine.slice(0, -1);
        }

        if (line.startsWith("From ")) {
          if (hasMessage) {
            const completed = finalizeCurrentMessage();
            if (completed && completed.raw.length > 0) {
              yield completed;
            }
          }
          currentFromLine = line;
          currentMsgLines = [];
          hasMessage = true;
        } else {
          hasMessage = true;
          const unescaped = unescapeMboxrd(line);
          currentMsgLines.push(unescaped + lineEnding);
        }

        newlineIdx = buffer.indexOf("\n");
      }
    }

    // Flush any remaining decoder buffer
    buffer += decoder.decode();

    if (buffer.length > 0) {
      if (buffer.startsWith("From ")) {
        if (hasMessage) {
          const completed = finalizeCurrentMessage();
          if (completed && completed.raw.length > 0) {
            yield completed;
          }
        }
        currentFromLine = buffer;
        currentMsgLines = [];
        hasMessage = true;
      } else {
        hasMessage = true;
        currentMsgLines.push(unescapeMboxrd(buffer));
      }
    }

    if (hasMessage) {
      const completed = finalizeCurrentMessage();
      if (completed && completed.raw.length > 0) {
        yield completed;
      }
    }
  } finally {
    if (reader) {
      try {
        reader.releaseLock();
      } catch {}
    }
  }
}
