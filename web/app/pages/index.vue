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
        <div v-for="(message, index) in messages" :key="index" class="mb-2">
          <UCard class="max-w-sm bg-accented rounded-2xl">
            {{ message }}
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

<script setup>
const prompt = ref("");
const messages = ref([]);

const sendMessage = () => {
  if (prompt.value.trim()) {
    messages.value.push(prompt.value.trim());
    prompt.value = "";
  }
};
</script>
