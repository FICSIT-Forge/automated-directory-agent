# Automated Directory Agent
An agentic application that provides assistance to [Satisfactory](https://www.satisfactorygame.com/) players about the game and attempts to embody the personality of in-game AI assistant called [ADA (Automated Directory &amp; Assistant)](https://satisfactory.wiki.gg/wiki/ADA).

## Types of assistance

1. General information about the game
2. Help with recipes and production chains
3. Help with exploration
4. Help with building and automation
5. Help with game mechanics
6. Help with game lore
7. Help with game secrets
8. Help with game easter eggs
9. Help with game achievements
10. Help with game mods
11. Help with game news
12. Help with game updates
13. Help with game patches
14. Help with game hotfixes

## Tech Stack

### Agent Backend

- [Typescript](https://www.typescriptlang.org/docs/)
- [Genkit](https://genkit.dev/)
- [Google GenAI](https://ai.google.dev/gemini-api/docs)
- [Firebase Functions](https://firebase.google.com/docs/functions)
- [Node.js 24](https://nodejs.org/en/docs/)
- [pnpm](https://pnpm.io/)

### Frontend

- [Typescript](https://www.typescriptlang.org/docs/)
- [Nuxt](https://nuxt.com/docs/4.x/getting-started/introduction)
- [NuxtUI AI Chat Components](https://ui.nuxt.com/docs/components#ai-chat) 
- [Nuxt MDC](https://nuxt.com/modules/mdc)
- Used [Nuxt AI Chatbot Template](https://github.com/nuxt-ui-templates/chat/tree/main/app) as the reference
- [Tailwind CSS](https://tailwindcss.com/)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)
- [pnpm](https://pnpm.io/)

## Project Structure

```
automated-directory-agent/
├── functions/                      # Genkit + Firebase Functions
│   ├── src/
│   │   ├── index.ts                # Genkit entry point
│   │   └── genkit.ts               # Genkit configuration
│   ├── prompts/
│   │   ├── adagent.prompt          # System prompt
│   │   └── _personality.prompt     # ADA's personality
│   ├── .gitignore
│   ├── .prettierignore
│   ├── eslint.config.mjs
│   ├── package.json
│   ├── pnpm-workspace.yaml
│   ├── tsconfig.dev.json
│   └── tsconfig.json
│
├── web/                            # Nuxt frontend
│   ├── app/                        # Nuxt App
│   │   ├── components/             # Nuxt Components
│   │   ├── layouts/                # Nuxt Layouts
│   │   ├── pages/                  # Nuxt Pages
│   │   ├── assets/                 # Nuxt assets
│   │   ├── utils/                  # Utils
│   │   ├── app.config.ts           # Nuxt app config
│   │   ├── app.vue                 # Nuxt app root
│   │   └── error.vue               # Nuxt error page
│   ├── public/                     # Public assets (e.g. images, etc.)
│   ├── .gitignore
│   ├── .prettierignore
│   ├── eslint.config.mjs
│   ├── nuxt.config.ts              # Nuxt config
│   ├── package.json
│   ├── pnpm-workspace.yaml
│   ├── tsconfig.json
│   └── README.md
│
├── .firebaserc
├── .gitignore
├── firebase.json
└── README.md
```
