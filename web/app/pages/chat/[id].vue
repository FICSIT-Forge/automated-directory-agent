<script setup lang="ts">
import { ref } from "vue";
import { Chat } from "@ai-sdk/vue";

import { FirebaseChatTransport } from "~/utils/firebase-chat-transport";
import { initializeApp } from "firebase/app";
import { getFunctions } from "firebase/functions";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";

definePageMeta({
  layout: "dashboard",
});

const config = useRuntimeConfig();
const route = useRoute();
const initialPrompt = useState<string | null>("chat-initial-prompt");
const input = ref(""); // Manual input ref

// Initialize Chat instance with our custom transport
console.log("🔧 Creating Chat instance...");
const chat = new Chat({
  id: route.params.id as string,
  transport: new FirebaseChatTransport(),
  messages: [],
});
console.log("🔧 Chat instance created:", chat);

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

// Initialize Firebase and handle initial prompt
onMounted(async () => {
  console.log("🔄 Component onMounted called");

  try {
    const response = await fetch("/__/firebase/init.json");
    if (response.ok) {
      const firebaseConfig = await response.json();
      console.log("[Debug] Firebase Config Keys:", Object.keys(firebaseConfig));
      console.log("[Debug] Recaptcha Key:", config.public.recaptchaSiteKey);
      const app = initializeApp(firebaseConfig);

      if (config.public.recaptchaSiteKey) {
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(
            config.public.recaptchaSiteKey as string,
          ),
          isTokenAutoRefreshEnabled: true,
        });
      }
      // Ensure functions instance is available for the transport
      getFunctions(app);
      console.log("🔄 Firebase initialized successfully");
    } else {
      console.warn(
        "Could not load Firebase init.json. Connectivity may be limited.",
      );
    }
  } catch (error) {
    console.error("Error initializing Firebase:", error);
  }

  // Check for initial prompt passed from index.vue
  if (initialPrompt.value) {
    const prompt = initialPrompt.value;
    initialPrompt.value = null; // Clear state
    console.log("🔄 Sending initial prompt:", prompt);
    await chat.sendMessage({ text: prompt });
  }

  console.log("🔄 Component onMounted completed");
});

// Add lifecycle logging
onBeforeUnmount(() => {
  console.log("🔄 Component onBeforeUnmount called");
});

onUnmounted(() => {
  console.log("🔄 Component onUnmounted called");
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
            <div class="flex items-center gap-1">
              <UButton
                icon="i-lucide-paperclip"
                color="neutral"
                variant="ghost"
                size="sm"
              />
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
