'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  endSandboxSubscription,
  loadOffers,
  manageSubscriptionUrl,
  purchasePlan,
  readUserSubscription,
  restorePurchases,
  type Offers,
  type ProPlan,
  type UserSubscription,
} from '@/lib/billing';
import type { CopyKey } from '@/lib/i18n';

export type PaywallReason = 'scan' | 'coach' | 'kitchen' | null;

type Translate = (key: CopyKey, vars?: Record<string, string | number>) => string;

type Props = {
  t: Translate;
  locale: string;
  isPro: boolean;
  reason: PaywallReason;
  onClose: () => void;
  onActivated: (subscription: UserSubscription, restored: boolean) => void;
  onEnded: () => void;
  onLegal: (kind: 'privacy' | 'terms') => void;
};

const BULLETS: readonly CopyKey[] = ['pwB1', 'pwB2', 'pwB3', 'pwB4'];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ProPaywall({ t, locale, isPro, reason, onClose, onActivated, onEnded, onLegal }: Props) {
  const [offers, setOffers] = useState<Offers | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription>(() => readUserSubscription());
  const [plan, setPlan] = useState<ProPlan>(() => readUserSubscription().plan ?? 'yearly');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    void loadOffers().then((next) => {
      if (live) setOffers(next);
    });
    return () => { live = false; };
  }, []);

  const sandbox = offers?.mode === 'sandbox';
  const active = isPro && subscription.isPro;
  const sameAsCurrent = active && subscription.plan === plan;
  const storeManaged = active && subscription.source === 'store';
  const reasonKey: CopyKey | null = reason === 'scan' ? 'pwReasonScan' : reason === 'coach' ? 'pwReasonCoach' : reason === 'kitchen' ? 'pwReasonKitchen' : null;

  const price = (target: ProPlan) => {
    const offer = offers?.[target];
    return offer ? `${offer.priceString}${t(target === 'yearly' ? 'pwPerYear' : 'pwPerMonth')}` : '…';
  };

  const startPurchase = async () => {
    if (busy) return;
    if (active && storeManaged) {
      window.open(manageSubscriptionUrl(subscription.plan), '_blank', 'noopener,noreferrer');
      return;
    }
    if (sameAsCurrent) {
      onClose();
      return;
    }
    setBusy(true);
    setNote('');
    const result = await purchasePlan(plan);
    setBusy(false);
    if (result.ok && result.active && result.subscription) {
      setSubscription(result.subscription);
      onActivated(result.subscription, false);
      return;
    }
    if (!result.ok && result.reason === 'cancelled') return;
    setNote(t('pwFail'));
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setNote('');
    const result = await restorePurchases();
    setBusy(false);
    if (result.ok && result.active && result.subscription) {
      setSubscription(result.subscription);
      onActivated(result.subscription, true);
      return;
    }
    setNote(result.ok ? t('pwNothing') : t('pwFail'));
  };

  const endSandbox = () => {
    endSandboxSubscription();
    setSubscription({ isPro: false, plan: null });
    onEnded();
  };

  const cta = busy
    ? '…'
    : storeManaged ? t('pwManage')
    : sameAsCurrent ? t('pwCurrent')
    : active ? t('pwSwitch')
    : plan === 'yearly' ? t('pwCtaTrial') : t('pwCtaMonthly');

  const planCard = (target: ProPlan, children: ReactNode, minHeight: string) => {
    const selected = plan === target;
    return (
      <button
        type="button"
        aria-pressed={selected}
        className={`flex ${minHeight} w-full flex-col justify-center gap-2 rounded-2xl px-4 py-3 text-start`}
        style={{
          background: selected ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)',
          boxShadow: selected ? 'inset 0 0 0 2px #fff' : 'inset 0 0 0 1px rgba(255,255,255,0.16)',
          color: '#fff',
        }}
        onClick={() => setPlan(target)}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 px-3 pb-6 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div
        className="on-gradient relative z-[81] w-full max-w-[390px] rounded-[28px] border border-white/10 p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-title"
        style={{ overflowY: 'auto', maxHeight: '90dvh', background: 'linear-gradient(168deg, #171b24 0%, #0e1117 62%)', color: '#f4f6f8', boxShadow: '0 24px 50px rgba(8, 10, 16, 0.28)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.16em] text-[#c4b5fd]">{t('pwBrand')}</p>
            <h2 id="pay-title" className="mt-1 text-[1.55rem] font-black leading-tight tracking-[-0.04em]">{active ? t('pwPlanTitle') : t('pwTitle')}</h2>
            <p className="mt-1 text-xs leading-snug text-[#c7cdd8]">{active ? t('pwActiveLine') : reasonKey ? t(reasonKey) : t('pwSubtitle')}</p>
          </div>
          <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }} aria-label={t('close')} onClick={onClose}>✕</button>
        </div>

        <ul className="mt-4 space-y-2">
          {BULLETS.map((key) => (
            <li key={key} className="flex items-center gap-2.5 text-sm font-semibold leading-snug">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#22c55e]/20 text-[#86efac]"><CheckIcon /></span>
              {t(key)}
            </li>
          ))}
        </ul>

        {active && (
          <div className="mt-4 rounded-2xl p-3 text-xs leading-relaxed" style={{ background: 'rgba(34,197,94,0.12)', boxShadow: 'inset 0 0 0 1px rgba(134,239,172,0.3)' }}>
            <p className="text-sm font-extrabold text-[#bbf7d0]">{t('proActive')}</p>
            <p className="mt-1 text-[#d1fae5]">
              {subscription.plan === 'yearly' ? t('pwYearly') : t('pwMonthly')}
              {subscription.trial ? ` · ${t('pwTrialActive')}` : ''}
              {subscription.renewsAt ? ` · ${formatDate(subscription.renewsAt, locale)}` : ''}
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          {planCard('yearly', (
            <>
              <span className="flex w-full items-center justify-between gap-3">
                <span className="text-sm font-extrabold">{t('pwYearly')}{active && subscription.plan === 'yearly' ? ' ✓' : ''}</span>
                <span className="text-base font-black tabular-nums">{price('yearly')}</span>
              </span>
              <span className="inline-flex w-fit rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-extrabold text-[#047857]">{t('pwBest')}</span>
              <span className="text-[11px] font-semibold text-[#c7cdd8]">{t('pwSave')}</span>
            </>
          ), 'min-h-[104px]')}
          {planCard('monthly', (
            <span className="flex w-full items-center justify-between gap-3">
              <span className="text-sm font-extrabold">{t('pwMonthly')}{active && subscription.plan === 'monthly' ? ' ✓' : ''}</span>
              <span className="text-base font-black tabular-nums">{price('monthly')}</span>
            </span>
          ), 'min-h-[64px]')}
        </div>

        <button
          type="button"
          className="relative z-[2] mt-4 h-12 w-full rounded-full bg-white text-sm font-extrabold disabled:opacity-60"
          style={{ color: '#0f1115' }}
          disabled={busy || (sameAsCurrent && !storeManaged) || !offers}
          onClick={() => void startPurchase()}
        >
          {offers ? cta : t('pwLoading')}
        </button>
        <p className="mt-2 px-1 text-center text-[11px] leading-snug text-[#c7cdd8]">{plan === 'yearly' ? t('pwLegalTrial') : t('pwLegalMonthly')}</p>

        {note && <p className="mt-2 text-center text-xs font-semibold text-[#fecaca]" role="status">{note}</p>}

        <div className="mt-3 flex flex-col items-center gap-2">
          <button type="button" className="text-xs font-semibold underline disabled:opacity-50" disabled={busy} onClick={() => void restore()}>{t('pwRestore')}</button>
          {active && !storeManaged && sandbox && (
            <button type="button" className="text-xs font-semibold text-[#fca5a5] underline" onClick={endSandbox}>{t('pwSandboxEnd')}</button>
          )}
          {active && storeManaged && (
            <a className="text-xs font-semibold underline" href={manageSubscriptionUrl(subscription.plan)} target="_blank" rel="noopener noreferrer">{t('pwManage')}</a>
          )}
        </div>

        {!active && (
          <button type="button" className="mt-3 h-11 w-full rounded-full text-sm font-extrabold" style={{ background: 'rgba(255,255,255,0.1)' }} onClick={onClose}>{t('pwContinue')}</button>
        )}

        <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-[#9aa3b2]">
          <button type="button" className="underline" onClick={() => onLegal('privacy')}>{t('privacyPolicy')}</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="underline" onClick={() => onLegal('terms')}>{t('termsOfUse')}</button>
        </div>
        {sandbox && <p className="mt-2 text-center text-[10px] font-semibold text-[#9aa3b2]">{t('pwSandbox')}</p>}
      </div>
    </div>
  );
}
