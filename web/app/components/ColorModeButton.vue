<script setup>
const colorMode = useColorMode();

const isDark = computed({
  get() {
    return colorMode.value === "dark";
  },
  set(_isDark) {
    colorMode.preference = _isDark ? "dark" : "light";
  },
});
</script>

<template>
  <ClientOnly>
    <UButton
      :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
      color="neutral"
      variant="ghost"
      @click="
        colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
      "
    />

    <template #fallback>
      <div class="size-8" />
    </template>
  </ClientOnly>
</template>
