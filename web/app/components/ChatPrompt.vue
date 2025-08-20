<template>
  <div class="flex items-end p-2 w-full max-w-3xl justify-center">
    <UTextarea
      v-model="prompt"
      placeholder="Ask me about Satisfactory, if you must..."
      class="flex-1 resize-none bg-transparent focus:outline-none focus:ring-0 border-0"
      autoresize
      :rows="4"
      :disabled="isSending"
      :ui="{ base: 'rounded-xl' }"
      trailing
      @keydown.enter.prevent.exact="handleSendMessage"
      @keydown.shift.enter.prevent="handleNewLine"
    >
      <template #trailing>
        <UButton
          size="xl"
          :disabled="!prompt.trim() || isSending"
          icon="i-lucide-send"
          :loading="isSending"
          variant="ghost"
          @click="handleSendMessage"
        />
      </template>
    </UTextarea>
  </div>
</template>

<script setup lang="ts">
const prompt = ref<string>("");

defineProps({
  isSending: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  (e: "sendMessage", prompt: string): void;
}>();

const handleSendMessage = () => {
  if (prompt.value.trim() === "") return;
  emit("sendMessage", prompt.value);
  prompt.value = "";
};

const handleNewLine = (event: KeyboardEvent) => {
  if (event.shiftKey) {
    prompt.value += "\n\n";
  }
};
</script>
