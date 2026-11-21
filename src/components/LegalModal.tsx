'use client';

import type { CopyKey } from '@/lib/i18n';

export type LegalKind = 'privacy' | 'terms';

type Section = { heading: string; body: string[] };

const UPDATED = 'November 2026';

const PRIVACY: Section[] = [
  {
    heading: 'Your data stays on your phone',
    body: [
      'FitBite Pro keeps your profile, meals, workouts, water, sleep, chat messages, settings, and watch pairing on this device. The app shows no ads and uses no ad tracking.',
    ],
  },
  {
    heading: 'General wellness, not a medical device',
    body: [
      'FitBite Pro is for general wellness and fitness tracking only. It does not diagnose, treat, cure, or prevent any condition and is not a medical device.',
      'Calories, macros, heart rate, recovery scores, and Halal or diet indicators are estimates. Always check product labels and speak to a qualified professional before changing your diet or training.',
    ],
  },
  {
    heading: 'AI photo and text processing',
    body: [
      'AI Scan, AI Coach, and AI Kitchen work only after you turn on AI cloud processing in Me, and only when you tap scan, send, or dictate.',
      'The photo, voice clip, or message you choose to send, together with your language, diet, and unit preferences, travels over HTTPS to the FitBite AI relay and then to Google Gemini or OpenRouter models to create the reply. The relay does not store your photos or messages. The AI providers process them under their own terms.',
      'Nothing is sold, shared for advertising, or used to build an ad profile. You can switch AI cloud processing off at any time and every other feature keeps working.',
    ],
  },
  {
    heading: 'Your GDPR rights',
    body: [
      'Access and portability: use Me, Privacy & Data, Export My Data (JSON).',
      'Erasure: use Me, Delete Account & Erase All Local Data. It removes every record stored by the app on this phone, including chat, meals, workouts, settings, and watch pairing.',
      'Withdraw consent: turn off AI cloud processing in Privacy & Data. Rectification: edit your profile and meals in the app.',
      'Our legal bases are your consent for AI processing and the performance of the service you asked for. You may also lodge a complaint with your local data protection authority.',
    ],
  },
  {
    heading: 'Permissions',
    body: [
      'Camera and photos for AI Scan and barcodes. Microphone for voice notes. Bluetooth (Nearby devices) to pair a heart-rate watch; on Android 11 and older Android requires Location for Bluetooth scanning, and FitBite does not store your location from that scan. Location during a workout you start, to measure distance.',
    ],
  },
  {
    heading: 'Subscriptions and payments',
    body: [
      'Purchases are processed by Google Play. FitBite Pro never sees or stores your card details. See the Terms of Use for renewal and cancellation.',
    ],
  },
  {
    heading: 'Children',
    body: ['FitBite Pro is not directed to children under 16. If you are under 16, use it only with a parent or guardian.'],
  },
];

const TERMS: Section[] = [
  {
    heading: 'Using FitBite Pro',
    body: ['By using the app you agree to these terms. If you do not agree, please uninstall the app. You are responsible for the accuracy of the information you enter.'],
  },
  {
    heading: 'Wellness disclaimer',
    body: [
      'FitBite Pro provides general wellness and fitness information only. It is not medical advice and not a medical device. Never ignore professional advice because of something you read in the app.',
      'AI answers, nutrition estimates, and Halal indicators can be wrong or incomplete. Verify ingredients and labels, especially for allergies, medical diets, or religious requirements.',
    ],
  },
  {
    heading: 'FitBite Pro subscription',
    body: [
      'FitBite Pro is an auto-renewing subscription offered monthly or yearly. The yearly plan includes a 7-day free trial for eligible new subscribers.',
      'Payment is charged to your Google Play account at confirmation of purchase, or at the end of the free trial. The subscription renews automatically unless you cancel at least 24 hours before the end of the current period. Your account is charged for renewal within 24 hours before the period ends at the price shown in Google Play.',
      'Cancel anytime in Google Play: open the Play Store, tap your profile, Payments & subscriptions, Subscriptions, then FitBite Pro. Uninstalling the app does not cancel the subscription. Refunds follow Google Play policy and your local consumer law, including EU rights of withdrawal where they apply.',
      'Prices include applicable taxes and may differ by country. Free-tier limits (3 AI Food Scans and 3 AI Coach messages per day) reset at midnight on your device.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: ['Do not misuse the app, attempt to disrupt the AI service, or send content you do not have the right to share.'],
  },
  {
    heading: 'Liability',
    body: ['The app is provided as is. To the extent allowed by law, FitBite Pro is not liable for decisions made from its estimates or for interruptions of third-party AI or store services.'],
  },
  {
    heading: 'Changes and contact',
    body: ['We may update these terms and will show the new date here. Questions or data requests: Me, VIP Support.'],
  },
];

type Props = {
  kind: LegalKind;
  url: string;
  t: (key: CopyKey) => string;
  onClose: () => void;
};

export function LegalModal({ kind, url, t, onClose }: Props) {
  const sections = kind === 'privacy' ? PRIVACY : TERMS;
  const title = kind === 'privacy' ? t('privacyPolicy') : t('termsOfUse');
  return (
    <div className="fixed inset-0 z-[90] grid place-items-end bg-black/55 px-3 pb-6 backdrop-blur-md sm:place-items-center" onClick={onClose}>
      <div className="card max-h-[88dvh] w-full max-w-[390px] overflow-y-auto p-5" role="dialog" aria-modal="true" aria-labelledby="legal-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="legal-title" className="text-xl font-black tracking-[-0.03em]">{title}</h2>
            <p className="mt-1 text-[11px] font-semibold text-muted">FitBite Pro · {UPDATED}</p>
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400" aria-label={t('close')} onClick={onClose}>✕</button>
        </div>
        <div className="mt-4 space-y-4 text-start" dir="ltr" lang="en">
          {sections.map((section) => (
            <section key={section.heading}>
              <h3 className="text-sm font-extrabold tracking-[-0.02em]">{section.heading}</h3>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-1.5 text-xs leading-relaxed text-slate-700">{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <a className="text-center text-xs font-extrabold underline" href={url} target="_blank" rel="noopener noreferrer">{t('legalOnline')}</a>
          <button type="button" className="h-11 w-full rounded-full bg-slate-100 text-sm font-extrabold" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  );
}
