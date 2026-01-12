import type { ChatTransport, UIMessageChunk, UIMessage } from "ai";
import { httpsCallable, getFunctions } from "firebase/functions";

export class FirebaseChatTransport implements ChatTransport<UIMessage> {
  private static instanceCount = 0;
  private instanceId: number;

  constructor() {
    this.instanceId = ++FirebaseChatTransport.instanceCount;
    console.log(`[Transport-${this.instanceId}] 🏗️ Constructor called`);
  }

  async sendMessages(options: {
    messages: UIMessage[];
  }): Promise<ReadableStream<UIMessageChunk>> {
    const instanceId = this.instanceId; // Capture for use in closures
    console.log(
      `[Transport-${instanceId}] 📤 sendMessages called at ${new Date().toISOString()}`,
    );
    console.log(
      `[Transport-${instanceId}] 📤 Messages count:`,
      options.messages.length,
    );

    const functions = getFunctions();

    const adagent = httpsCallable(functions, "adagent");
    const lastMessage = options.messages[options.messages.length - 1];

    if (!lastMessage || lastMessage.role !== "user") {
      throw new Error("No user message found to send.");
    }

    // Extract text content from the message - handle both content and parts
    let content = "";

    // Try to access content property safely with proper typing
    const messageAny = lastMessage as UIMessage & {
      content?: string;
      parts?: Array<{ type: string; text: string }>;
    };

    if (messageAny.content && typeof messageAny.content === "string") {
      content = messageAny.content;
    } else if (messageAny.parts && Array.isArray(messageAny.parts)) {
      content = messageAny.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
    }

    // Use AbortController for proper cancellation handling
    const abortController = new AbortController();
    let streamStartTime: number;
    let chunkCount = 0;

    return new ReadableStream({
      async start(controller) {
        streamStartTime = Date.now();
        const messageId = "gen-" + Date.now().toString();
        try {
          const result = await adagent.stream({ question: content });

          console.log(`[Transport-${instanceId}] 📞 Got stream result:`, {
            hasStream: !!result.stream,
            hasData: !!result.data,
            resultKeys: Object.keys(result),
          });

          controller.enqueue({
            type: "text-start",
            id: messageId,
          });

          // Convert AsyncIterable<StreamData> to ReadableStream<UIMessageChunk>
          for await (const chunk of result.stream) {
            chunkCount++;

            // Check if stream was cancelled/aborted
            if (abortController.signal.aborted) {
              console.log(
                `[Transport-${instanceId}] ❌ Cancellation detected at ${new Date().toISOString()}. Stopping chunk processing (chunk #${chunkCount})`,
              );
              return; // Exit without trying to enqueue or close
            }

            // Extract text from the chunk - the chunk structure may vary
            const text =
              typeof chunk === "string"
                ? chunk
                : chunk && typeof chunk === "object" && "text" in chunk
                  ? (chunk as { text: string }).text
                  : JSON.stringify(chunk);

            // Only enqueue if stream is not aborted
            if (!abortController.signal.aborted) {
              try {
                controller.enqueue({
                  type: "text-delta",
                  delta: text,
                  id: messageId,
                });
              } catch (enqueueError) {
                console.error(
                  `[Transport-${instanceId}] ❌ Could not enqueue chunk #${chunkCount}:`,
                  enqueueError,
                );
                return; // Exit gracefully
              }
            } else {
              console.log(
                `[Transport-${instanceId}] ⚠️ Skipping enqueue for chunk #${chunkCount} - stream aborted`,
              );
            }
          }

          const streamEndTime = Date.now();
          console.log(
            `[Transport-${instanceId}] 🏁 Stream iteration completed`,
          );
          console.log(
            `[Transport-${instanceId}] 🏁 Total chunks processed: ${chunkCount}`,
          );
          console.log(
            `[Transport-${instanceId}] 🏁 Total stream time: ${streamEndTime - streamStartTime}ms`,
          );

          // Send finish message and close stream only if not aborted
          if (!abortController.signal.aborted) {
            try {
              console.log(
                `[Transport-${instanceId}] 🎬 Sending finish message...`,
              );
              controller.enqueue({
                type: "text-end",
                id: messageId,
              });
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
              });
              controller.close();
              console.log(
                `[Transport-${instanceId}] 🎬 Stream closed successfully`,
              );
            } catch (closeError) {
              console.error(
                `[Transport-${instanceId}] ❌ Could not close stream:`,
                closeError,
              );
            }
          } else {
            console.log(
              `[Transport-${instanceId}] ⚠️ Skipping finish/close - stream was aborted`,
            );
          }
        } catch (error) {
          console.error(`[Transport-${instanceId}] 💥 Stream error:`, error);
          console.error(
            `[Transport-${instanceId}] 💥 Error stack:`,
            (error as Error).stack,
          );
          if (!abortController.signal.aborted) {
            try {
              controller.error(error);
            } catch (errorError) {
              console.error(
                `[Transport-${instanceId}] ❌ Could not error stream:`,
                errorError,
              );
            }
          }
        }
      },

      cancel(reason) {
        const cancelTime = Date.now();
        console.log(
          `[Transport-${instanceId}] 🛑 STREAM CANCELLED at ${new Date(cancelTime).toISOString()} :: Reason: ${reason}`,
        );
        console.log(
          `[Transport-${instanceId}] 🛑 Chunks processed before cancel: ${chunkCount}`,
        );
        abortController.abort();
      },
    });
  }

  /*
   * Reconnection is not supported by this stateless transport.
   */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    console.log(`[Transport-${this.instanceId}] 🔄 reconnectToStream called`);
    return null;
  }
}
