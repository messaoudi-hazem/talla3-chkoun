<div align="center">

# 🎭 WHOSDAT? <sub>(طلع شكون)</sub>

**A multiplayer party game where you guess your friends' secret characters — judged by AI.**

[![Play Now](https://img.shields.io/badge/Play%20Now-talla3--chkoun.vercel.app-6d28d9?style=for-the-badge)](https://talla3-chkoun.vercel.app/)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black&style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=flat-square)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white&style=flat-square)
![Firebase](https://img.shields.io/badge/Firebase-Realtime-FFCA28?logo=firebase&logoColor=black&style=flat-square)


**[▶ Play the game](https://talla3-chkoun.vercel.app/)** · **[View app in AI Studio](https://ai.studio/apps/f4236630-ca0b-4650-b2a9-652df5388054)**

</div>

---

## 🕹️ What is WHOSDAT?

**"Talla3 Chkoun" (طلع شكون)** is North African slang for *"guess who it is"* — and that's exactly the game.

Everyone joins a room from their phone, secretly picks a character, and the group takes turns asking yes/no-style questions to figure out who has which character. The twist: instead of rigid keyword matching, **an AI judge (Gemini) reads the intent behind every guess** and decides whether it's close enough — so "he's a wizard" and "he does magic" can both count as a correct match, just like a real friend would judge it.

No app to install. No accounts. Scan a QR code, join the room, and play from any browser.

## ✨ Features

- 📱 **Instant multiplayer lobbies** — host creates a room, players join by scanning a QR code or entering a room code
- 🔄 **Real-time sync** — powered by Firebase/Firestore, so every guess, reveal, and score updates live for all players
- 🎨 **Smooth, animated UI** — built with Tailwind CSS and Framer Motion for a snappy, mobile-first feel
- 🌍 **Play anywhere** — nothing to install, works on any device with a browser

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Animations | Framer Motion (`motion`) |
| Backend | Express (`api/server.ts`), bundled with esbuild |
| Realtime data | Firebase / Firestore |
| AI matching | Google Gemini API (`@google/genai`) |
| Room joining | `qrcode.react` |
| Hosting | Vercel |

## 🚀 Run Locally

**Prerequisites:** [Node.js](https://nodejs.org/)

**1. Clone the repo**
```bash
git clone https://github.com/messaoudi-hazem/talla3-chkoun.git
cd talla3-chkoun
```

**2. Install dependencies**
```bash
npm install
```

**3. Configure environment variables**

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `APP_URL` | The URL this app is hosted at (used for QR code join links) |
| `VITE_FIREBASE_API_KEY` | Firebase project API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |
| `VITE_FIREBASE_DATABASE_ID` | Firestore database ID (usually `(default)`) |

> Create a free Firebase project at [console.firebase.google.com](https://console.firebase.google.com/) and enable **Firestore**. The security rules to deploy are already included in [`firestore.rules`](./firestore.rules).

**4. Run the dev server**
```bash
npm run dev
```

The app will be available locally — open it on your phone and another device on the same network to test multiplayer.

### Other scripts

```bash
npm run build   # Build the client + bundle the server for production
npm run start   # Run the production build
npm run lint    # Type-check the project with tsc
npm run clean   # Remove build artifacts
```

## 📁 Project Structure

```
talla3-chkoun/
├── api/                  # Express backend (Gemini API calls, server logic)
├── src/                  # React frontend (game screens, components, hooks)
├── assets/               # Static assets
├── firestore.rules       # Firestore security rules
├── firebase-blueprint.json
├── metadata.json         # App metadata (name, description, capabilities)
├── vercel.json           # Vercel deployment config
└── vite.config.ts
```

## ☁️ Deployment

This project is deployed on **Vercel**: **[talla3-chkoun.vercel.app](https://talla3-chkoun.vercel.app/)**

To deploy your own copy:
1. Push the repo to your own GitHub account
2. Import it into [Vercel](https://vercel.com/new)
3. Add all the environment variables listed above in your Vercel project settings
4. Deploy 🎉

## 🤝 Contributing

Issues and pull requests are welcome — feel free to open one if you spot a bug or have an idea for a new feature (new question modes, character packs, translations, etc.).



<div align="center">
<sub>Built with ❤️ by <a href="https://github.com/messaoudi-hazem">messaoudi-hazem</a></sub>
</div>