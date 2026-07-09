<script setup lang="ts">
// Rolling FICSIT-flavored status lines shown while ADAgent prepares a
// response (issue #18) — replaces the stock three-dot indicator.
const lines = [
  "Querying the FICSIT knowledge base…",
  "Cross-referencing recipe schematics…",
  "Consulting Project Assembly records…",
  "Running mandatory compliance checks…",
  "Recalibrating sarcasm emitters…",
  "Evaluating pioneer efficiency (results pending)…",
  "Filing paperwork in triplicate…",
];

const index = ref(Math.floor(Math.random() * lines.length));
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    index.value = (index.value + 1) % lines.length;
  }, 2200);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="flex items-center gap-2 text-sm text-dimmed">
    <UIcon name="i-lucide-loader-circle" class="animate-spin size-4" />
    <Transition name="fade" mode="out-in">
      <span :key="index">{{ lines[index] }}</span>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
