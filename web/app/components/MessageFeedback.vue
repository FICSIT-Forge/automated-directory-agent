<script setup lang="ts">
import { ref } from "vue";
import { getFunctions, httpsCallable } from "firebase/functions";

const props = defineProps<{
  question: string;
  answer: string;
  sessionId?: string;
}>();

const submitted = ref<"up" | "down" | null>(null);
const pending = ref(false);

async function send(verdict: "up" | "down") {
  if (submitted.value || pending.value) return;
  pending.value = true;
  try {
    await httpsCallable(
      getFunctions(),
      "submitFeedback",
    )({
      verdict,
      question: props.question,
      answer: props.answer,
      sessionId: props.sessionId,
    });
    submitted.value = verdict;
  } catch (error) {
    console.error("Feedback submit failed:", error);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="flex items-center gap-1 mt-2">
    <template v-if="!submitted">
      <UButton
        icon="i-lucide-thumbs-up"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Good answer"
        :disabled="pending"
        @click="send('up')"
      />
      <UButton
        icon="i-lucide-thumbs-down"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Bad answer"
        :disabled="pending"
        @click="send('down')"
      />
    </template>
    <span v-else class="text-xs text-dimmed">
      Feedback filed with FICSIT Quality Assurance. Efficiency appreciated.
    </span>
  </div>
</template>
