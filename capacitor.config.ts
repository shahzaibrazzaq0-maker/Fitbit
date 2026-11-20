import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Drop hosted HTTPS URLs here before Play Console upload.
 * The defaults open the static pages shipped in `public/`.
 */
export const APP_LEGAL_URLS = {
  privacy: 'https://fitbite-pro.vercel.app/privacy',
  terms: 'https://fitbite-pro.vercel.app/terms',
  deleteAccount: 'https://fitbite-pro.vercel.app/delete-account.html',
} as const;

const config: CapacitorConfig = {
  appId: 'com.fitbitepro.app',
  appName: 'FitBite Pro',
  webDir: 'out',
  // Leave server.url unset. It would load the whole UI from the network.
  // Native AI calls use https://fitbite-pro.vercel.app in src/lib/aiEngine.ts.
  backgroundColor: '#0B0D12',
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 400,
      backgroundColor: '#0B0D12',
      showSpinner: false,
    },
  },
};

export default config;