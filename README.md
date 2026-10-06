# Pharmora POS

Pharmora POS is a production-grade retail point of sale and pharmacy management platform designed as a **Responsive Web App**, **Installable PWA (Progressive Web App)**, and **Native Android App (Capacitor)**.

---

## Technology Stack

- **Frontend**: React 19, Vite, TypeScript, React Router, Vanilla CSS design tokens.
- **Mobile & Android**: Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/haptics`).
- **PWA & Offline**: Web App Manifest, Service Worker (`sw.js`) with shell asset caching & strict offline financial guard.
- **Scanner**: Camera-based barcode scanner (`html5-qrcode`) with rear camera auto-detection, reticle viewfinder, and manual fallback.
- **Backend**: Node.js, Express, TypeScript, Zod validation, JWT authentication.
- **Database**: PostgreSQL (Neon Cloud DB `pharmora_pos_dev`) with Prisma ORM.

---

## 1. Local Web Setup

1. Copy `.env.example` to `.env` in `server/` and configure database connection.
2. Install dependencies:
   ```bash
   npm install
   npm run dev
   ```
3. Web Application: `http://localhost:5173`
4. Backend API: `http://localhost:4000`

---

## 2. Production Web Setup

1. Build backend server:
   ```bash
   npm run build --prefix server
   ```
2. Build production web frontend:
   ```bash
   npm run build --prefix client
   ```
3. Start production server:
   ```bash
   npm start --prefix server
   ```

---

## 3. PWA Installation

- **Manifest**: Located at `/manifest.webmanifest` (App name: *Pharmora POS*, Short name: *Pharmora*, Theme: `#0f172a`).
- **Service Worker**: Registered via `/sw.js` to cache app shell, icons, and static assets.
- **Installation**:
  - **Chrome/Desktop**: Click the install icon in the address bar to install standalone desktop app.
  - **Android/Chrome**: Tap **"Install App"** / **"Add to Home Screen"** for full-screen standalone PWA.
- **Safe Offline Behavior**:
  - App shell loads instantly when offline.
  - Offline banner clearly notifies the user that financial transactions (Sales, Purchases, Cashbook, Daily Closing) require an active server connection.
  - API mutations are never blindly faked offline.

---

## 4. Android Development (Capacitor)

- **Application ID**: `com.codewithkalpesh.pharmorapos`
- **App Name**: `Pharmora POS`
- **Capacitor Configuration**: `client/capacitor.config.ts`
- **Android Directory**: `client/android/`

### Syncing Web Assets to Android
```bash
cd client
npm run build
npx cap sync android
```

### Opening in Android Studio
```bash
cd client
npx cap open android
```

---

## 5. Android Debug APK

To assemble the debug APK directly using Gradle:
```bash
cd client/android
./gradlew assembleDebug
```

**Output APK Path**:
`client/android/app/build/outputs/apk/debug/app-debug.apk`

---

## 6. Production API Configuration

Configure the production backend URL using the environment variable in `client/.env.production`:
```env
VITE_API_URL=https://your-production-api-domain.com
```

- **Android / Web dynamic resolution**: All frontend components read `import.meta.env.VITE_API_URL ?? 'http://localhost:4000'`.
- **CORS Support**: Server `server/src/config/env.ts` accepts comma-separated allowed origins in `CLIENT_URL` along with `capacitor://localhost`, `https://localhost`, and `http://localhost`.
