<script setup lang="ts">
import { ref } from "vue";
import { Chat } from "@ai-sdk/vue";
import { GenkitChatTransport } from "@genkit-ai/vercel-ai/client";

import { initFirebase, appCheckHeaders } from "~/utils/firebase";

definePageMeta({
  layout: "dashboard",
});

const config = useRuntimeConfig();
const route = useRoute();
const initialPrompt = useState<string | null>("chat-initial-prompt");
const input = ref(""); // Manual input ref

// Server-managed conversation: the chat id (a bare UUID from index.vue) is
// sent as the agent's sessionId and history is persisted in Firestore by the
// agent runtime — the client holds no conversation state (issue #18).
const chat = new Chat({
  id: route.params.id as string,
  transport: new GenkitChatTransport({
    url: config.public.agentUrl as string,
    headers: appCheckHeaders,
  }),
  messages: [],
});

// Manual submit handler since we are using Chat class directly
const handleSubmit = async () => {
  const text = input.value.trim();
  if (!text) return;

  // Clear input first
  input.value = "";

  try {
    await chat.sendMessage({
      text: text,
      // files: ... (if we had files)
    });
  } catch (error) {
    console.error("🚀 Error in handleSubmit:", error);
  }
};

// Text of the user question that a given assistant message answered — the
// nearest preceding user message. Pairs question+answer for feedback docs.
function questionFor(messageId: string): string {
  const idx = chat.messages.findIndex((m) => m.id === messageId);
  for (let i = idx - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m?.role === "user") return messageText(m);
  }
  return "";
}

function messageText(message: { parts: Array<{ type: string }> }): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function getFileName(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split("/").pop() || "file";
    return decodeURIComponent(filename);
  } catch {
    return "file";
  }
}

// ... existing code ...

// Initialize Firebase (App Check + feedback callable) and handle the
// initial prompt handed over from index.vue.
onMounted(async () => {
  try {
    await initFirebase(config.public.recaptchaSiteKey as string);
  } catch (error) {
    console.error("Error initializing Firebase:", error);
  }

  if (initialPrompt.value) {
    const prompt = initialPrompt.value;
    initialPrompt.value = null; // Clear state
    await chat.sendMessage({ text: prompt });
  }
});
</script>

<template>
  <UDashboardPanel id="chat" class="relative" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <DashboardNavbar />
    </template>

    <template #body>
      <UContainer class="flex-1 flex flex-col gap-4 sm:gap-6">
        <UChatMessages
          should-auto-scroll
          :messages="chat.messages"
          :status="chat.status"
          :spacing-offset="160"
          class="lg:pt-(--ui-header-height) pb-4 sm:pb-6"
        >
          <template #content="{ message }">
            <template
              v-for="(part, index) in message.parts"
              :key="`${message.id}-${part.type}-${index}${'state' in part ? `-${part.state}` : ''}`"
            >
              <MDCCached
                v-if="part.type === 'text' && message.role === 'assistant'"
                :value="part.text"
                :cache-key="`${message.id}-${index}`"
                class="prose dark:prose-invert max-w-none *:first:mt-0 *:last:mb-0"
              />
              <!-- User messages are rendered as plain text (safely escaped by Vue) -->
              <p
                v-else-if="part.type === 'text' && message.role === 'user'"
                class="whitespace-pre-wrap"
              >
                {{ part.text }}
              </p>
              <FileAvatar
                v-else-if="part.type === 'file'"
                :name="getFileName(part.url)"
                :type="part.mediaType"
                :preview-url="part.url"
              />
            </template>
            <MessageFeedback
              v-if="message.role === 'assistant' && chat.status === 'ready'"
              :question="questionFor(message.id)"
              :answer="messageText(message)"
              :session-id="route.params.id as string"
            />
          </template>
          <template #indicator>
            <ThinkingIndicator />
          </template>
        </UChatMessages>

        <UChatPrompt
          v-model="input"
          variant="subtle"
          class="sticky bottom-0 [view-transition-name:chat-prompt] rounded-b-none z-10"
          :ui="{ base: 'px-1.5' }"
          @submit="handleSubmit"
        >
          <template #footer>
            <div class="flex items-center gap-1 min-w-0">
              <UButton
                icon="i-lucide-paperclip"
                color="neutral"
                variant="ghost"
                size="sm"
              />
              <span class="text-[11px] text-dimmed truncate">
                Questions &amp; answers are logged to improve ADAgent — please
                don't include personal information.
              </span>
            </div>
            <UChatPromptSubmit
              color="neutral"
              size="sm"
              :disabled="
                chat.status === 'streaming' || chat.status === 'submitted'
              "
            />
          </template>
        </UChatPrompt>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
