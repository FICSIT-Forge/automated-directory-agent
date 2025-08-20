<template>
  <div
    class="flex-1 pt-16 pb-4 px-4 flex flex-col justify-between items-center"
  >
    <div
      ref="chatContainer"
      class="flex-1 overflow-y-auto p-4 space-y-4 w-full max-w-4xl"
      style="scroll-padding-top: 20px"
    >
      <div
        v-for="message in messages"
        :key="message.id"
        class="flex"
        :class="{
          'justify-end': message.sender === 'user',
          'justify-start': message.sender === 'bot',
        }"
        :data-message-id="message.id"
      >
        <UCard v-if="message.sender === 'user'" variant="subtle">
          <MDC :value="message.content" />
        </UCard>

        <UCard
          v-else
          class="text-gray-800 dark:text-gray-200 bg-gray-200 dark:bg-gray-800 rounded-lg p-3 shadow-md"
          :ui="{
            body: 'p-2',
          }"
        >
          <div
            v-if="message.status === 'loading'"
            class="flex items-center space-x-2"
          >
            <USkeleton class="h-4 w-[250px]" />
            <USkeleton class="h-4 w-[200px]" />
            <USkeleton class="h-4 w-[230px]" />
          </div>
          <div v-else class="prose dark:prose-invert">
            <MDC :value="message.content" />
          </div>
        </UCard>
      </div>
    </div>

    <ChatPrompt :is-sending="isSending" @send-message="sendMessage" />
  </div>
</template>

<script setup lang="ts">
import { v4 as uuidv4 } from "uuid";
import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { getFunctions, httpsCallable } from "firebase/functions";

const config = useRuntimeConfig();

// import { getAnalytics } from "firebase/analytics";

// 1. Define the Message Interface (can be in a separate types/chat.d.ts file)
interface Message {
  id: string;
  content: string;
  sender: "user" | "bot";
  status: "sent" | "loading" | "received" | "error";
}

// 2. Add type annotations to reactive variables
const messages = ref<Message[]>([]); // Array of Message objects
const isSending = ref<boolean>(false);
const chatContainer = ref<HTMLElement | null>(null); // Ref can be null initially, then HTMLElement

// Initialize Firebase on the client-side for Prerendering.
onMounted(() => {
  const firebaseConfig = useCookie("__firebase_init");
  if (!firebaseConfig.value) {
    fetch("/__/firebase/init.json")
      .then((response) => response.json())
      .then((conf) => {
        const app = initializeApp(conf);
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(
            config.public.recaptchaSiteKey as string,
          ),
          isTokenAutoRefreshEnabled: true, // Set to true to allow auto-refresh.
          // const analytics = getAnalytics(app);
        });
      })
      .catch((error: unknown) => {
        if (error instanceof Error) {
          console.error("Error initializing Firebase:", error);
        } else {
          console.error("Unknown error initializing Firebase:", error);
        }
      });
  }

  greeting();
});

// Initial welcome message (optional)
async function greeting(): Promise<void> {
  const welcomeMarkdown: string = `# Welcome!
    
  Hello Pioneer! I'm **ADAgent**, also known as Automated Directory Agent, tasked to support FICSIT pioneers, such as yourself, in their mission. Ask me anything about [Satisfactory](https://www.satisfactorygame.com/)!
    
  Here's a list of things I can do:
    
  - Provide information about the game
  - Help you "Save the Day!"
  - Troubleshoot your factory
    
  Let's get started!`;

  messages.value.push({
    id: uuidv4(),
    content: welcomeMarkdown,
    sender: "bot",
    status: "received",
  });
}

// Watch for changes in messages and scroll to bottom
watch(
  messages,
  async () => {
    await nextTick(); // Wait for DOM update
    setTimeout(() => {
      if (chatContainer.value && messages.value.length > 0) {
        const lastMessageId = messages.value[messages.value.length - 1]?.id;
        const lastMessageElement = chatContainer.value.querySelector(
          `[data-message-id="${lastMessageId}"]`,
        ) as HTMLElement;
        if (lastMessageElement) {
          lastMessageElement.scrollIntoView({
            block: "start",
            behavior: "smooth",
          });
        }
      }
    }, 50);
  },
  { deep: true },
);

async function sendMessage(userPrompt: string): Promise<void> {
  // Specify return type for functions
  if (!userPrompt.trim() || isSending.value) return;
  isSending.value = true;

  const userMessageId = uuidv4();
  const botMessageId: string = uuidv4();

  // User prompt chat bubble
  messages.value.push({
    id: userMessageId,
    content: userPrompt,
    sender: "user",
    status: "sent",
  });

  // Add a loading message for the bot's response
  messages.value.push({
    id: botMessageId,
    content: "",
    sender: "bot",
    status: "loading",
  });

  callAgentAndRenderResponse(userPrompt, botMessageId);
}

async function callAgentAndRenderResponse(prompt: string, messageId: string) {
  const adagentFlow = httpsCallable(getFunctions(), "adagent");

  try {
    const { stream } = await adagentFlow.stream(prompt);

    for await (const chunk of stream) {
      const currentMessage = messages.value.find((msg) => msg.id === messageId);
      if (currentMessage) {
        if (currentMessage.status === "loading") {
          currentMessage.content = chunk as string;
          currentMessage.status = "received";
        } else {
          currentMessage.content += chunk as string;
        }
      }
    }
  } catch (error: unknown) {
    const currentMessage = messages.value.find((msg) => msg.id === messageId);
    if (currentMessage) {
      if (error instanceof Error) {
        console.error("Error getting response: ", error.message);
      } else {
        console.error("An unknown error occurred: ", error);
      }
      currentMessage.content = "I'm busy right now. Try to help yourself.";
      currentMessage.status = "error";
    }
  } finally {
    isSending.value = false;
  }
}
</script>

<style>
.flex[data-message-id] {
  /* Target the message wrappers */
  scroll-margin-top: 20px; /* Adjust as needed */
}
</style>
