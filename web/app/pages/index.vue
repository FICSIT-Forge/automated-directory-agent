<template>
  <div class="flex flex-col h-screen">
    <!-- Fixed Header -->
    <div
      class="fixed top-0 left-0 w-full bg-white dark:bg-gray-900 z-10 p-4 text-center shadow-md"
    >
      <div class="flex flex-row">
        <h1 class="font-bold text-2xl text-(--ui-primary)">ADAgent</h1>
        <ColorModeButton class="ml-auto" />
      </div>
    </div>

    <!-- Main content area and Textarea container (centered and limited width) -->
    <div
      class="flex-grow overflow-y-auto pt-16 pb-4 px-4 flex flex-col justify-between items-center"
    >
      <div class="w-full max-w-3xl flex-grow overflow-y-auto">
        <!-- Chat messages will be rendered here -->
        <div
          v-for="(message, index) in messages"
          :key="index"
          :ref="
            (el) => {
              currPrompt = el as HTMLElement;
            }
          "
          class="mb-2"
        >
          <UCard
            class="w-full rounded-2xl"
            :class="{ 'bg-accented': message.isUser }"
          >
            <div v-html="renderMarkdown(message.content)" />
          </UCard>
        </div>
      </div>
      <!-- Textarea at the bottom -->
      <div class="w-full max-w-3xl mt-4 flex">
        <UTextarea
          v-model="prompt"
          class="flex-grow"
          placeholder="Type your message here..."
          :rows="3"
          trailing
          @keydown.enter.prevent.exact="sendMessage"
        >
          <template #trailing>
            <UButton
              size="xl"
              :disabled="!prompt.trim()"
              color="gray"
              variant="ghost"
              icon="i-lucide-send"
              @click="sendMessage"
            />
          </template>
        </UTextarea>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { marked } from "marked";

// Initialize Firebase on the client-side for Prerendering.
onMounted(async () => {
  try {
    const firebaseConfig = await fetch("/__/firebase/init.json");
    initializeApp(await firebaseConfig.json());
  } catch (error) {
    console.error("Error initializing Firebase:", error);
  }
});

interface ChatMessage {
  isUser: boolean;
  content: string;
}

const prompt = ref<string>("");
const messages = ref<ChatMessage[]>([]);
const currPrompt = ref<HTMLElement | null>(null);
const thinkingStr = "Thinking...";

const sendMessage = () => {
  if (prompt.value.trim()) {
    messages.value.push({ isUser: true, content: prompt.value.trim() });
    messages.value.push({ isUser: false, content: thinkingStr });
    suggestMenu(prompt.value.trim(), messages.value.length - 1);
    prompt.value = "";
  }
};

async function suggestMenu(subject: string, messageIndex: number) {
  const menuSuggestionFlow = httpsCallable(getFunctions(), "menuSuggestion");

  try {
    const { stream } = await menuSuggestionFlow.stream(subject);

    for await (const chunk of stream) {
      if (messages.value[messageIndex]?.content === thinkingStr) {
        messages.value[messageIndex].content = chunk as string;
      } else {
        messages.value[messageIndex].content += chunk as string;
      }
    }
  } catch (error) {
    console.error("Error generating menu suggestion: ", error);
    messages.value[messageIndex].content = "Error generating menu suggestion.";
  }
}

const renderMarkdown = (markdownText: string) => {
  return marked(markdownText);
};

watch(
  messages,
  () => {
    // Ensure the DOM is updated before attempting to scroll
    nextTick(() => {
      if (currPrompt.value) {
        currPrompt.value.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  },
  { deep: true },
);
</script>
