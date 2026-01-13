<script setup lang="ts">
const open = ref(false);

// Mock Chats Data
const chats = ref([
  {
    id: "1",
    label: "Welcome to ADA",
    to: "/",
    icon: "i-lucide-message-circle",
  },
]);

const items = computed(() => {
  return [
    {
      label: "Recent Chats",
      type: "label" as const,
    },
    ...chats.value.map((chat) => ({
      ...chat,
      slot: "chat" as const,
    })),
  ];
});

function deleteChat(id: string) {
  console.log("Delete chat", id);
}
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      :min-size="12"
      collapsible
      resizable
      class="bg-elevated/50"
    >
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-end gap-0.5">
          <img src="/ADALogo.png" alt="ADA" class="h-8 w-auto shrink-0" >
          <span v-if="!collapsed" class="text-xl font-bold text-highlighted"
            >gent</span
          >
        </NuxtLink>

        <div v-if="!collapsed" class="flex items-center gap-1.5 ms-auto">
          <UDashboardSidebarCollapse />
        </div>
      </template>

      <template #default="{ collapsed }">
        <div class="flex flex-col gap-1.5">
          <UButton
            v-bind="
              collapsed ? { icon: 'i-lucide-plus' } : { label: 'New chat' }
            "
            variant="soft"
            block
            to="/"
            @click="open = false"
          />

          <template v-if="collapsed">
            <UDashboardSidebarCollapse />
          </template>
        </div>

        <UNavigationMenu
          v-if="!collapsed"
          :items="items"
          :collapsed="collapsed"
          orientation="vertical"
          :ui="{ link: 'overflow-hidden' }"
        >
          <template #chat-trailing="{ item }">
            <div
              class="flex -mr-1.25 translate-x-full group-hover:translate-x-0 transition-transform"
            >
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-muted hover:text-primary hover:bg-accented/50 focus-visible:bg-accented/50 p-0.5"
                tabindex="-1"
                @click.stop.prevent="deleteChat((item as any).id)"
              />
            </div>
          </template>
        </UNavigationMenu>
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
