<script setup lang="ts">
import { v4 as uuidv4 } from "uuid";

definePageMeta({
  layout: "dashboard",
});

const input = ref("");
const initialPrompt = useState<string | null>("chat-initial-prompt");

const onSubmit = async () => {
  if (!input.value.trim()) return;

  const newId = uuidv4();
  initialPrompt.value = input.value;

  await navigateTo(`/chat/${newId}`);
};
</script>

<template>
  <UDashboardPanel id="chat" class="relative" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <DashboardNavbar />
    </template>

    <template #body>
      <UContainer
        class="flex-1 flex flex-col justify-center items-center gap-4 sm:gap-6 pb-24"
      >
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">
          How can I help you today?
        </h1>

        <p class="text-gray-500 dark:text-gray-400 text-center max-w-lg">
          I am <strong>ADAgent</strong>, also known as Automated Directory
          Agent, tasked to support FICSIT pioneers, such as yourself, in their
          mission.
        </p>

        <div class="w-full max-w-2xl px-4">
          <UChatPrompt
            v-model="input"
            variant="subtle"
            :ui="{ base: 'px-1.5' }"
            placeholder="Type your message..."
            @submit="onSubmit"
          >
            <template #footer>
              <div class="flex items-center gap-1">
                <!-- Optional: File Upload Button if needed in future -->
                <UButton
                  icon="i-lucide-paperclip"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                />
              </div>
              <UChatPromptSubmit color="neutral" size="sm" />
            </template>
          </UChatPrompt>
        </div>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
