// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-16",
  devtools: { enabled: true },
  modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxt/test-utils", "@nuxtjs/mdc"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    public: {
      recaptchaSiteKey: "6LeJsoorAAAAALd5sWG1u0ODniWoGbsVUuNFLHoS",
      // Agent endpoint. Same-origin in production via the Hosting rewrite
      // (/api/** → adagentApi). For local dev against the Functions emulator
      // set NUXT_PUBLIC_AGENT_URL, e.g.
      // http://127.0.0.1:5001/ficsit-forge/us-central1/adagentApi/api/adagent
      agentUrl: "/api/adagent",
    },
  },
});
