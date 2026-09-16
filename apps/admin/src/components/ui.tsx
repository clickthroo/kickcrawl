import { useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import type { KickioProfile } from '../lib/types';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100',
    danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 active:bg-red-100',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-[2.5rem] items-center justify-center whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Consistent responsive page header: title (+ optional subtitle) on the
 * left, action buttons on the right - stacked full-width on mobile,
 * inline on wider screens rather than squeezing/wrapping awkwardly.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-slate-800">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Select({
  label,
  className = '',
  ...props
}: { label?: string; className?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const select = (
    <select
      {...props}
      className={`min-h-[2.5rem] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ${className}`}
    />
  );
  if (!label) return select;
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {select}
    </label>
  );
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  fetched: 'bg-green-100 text-green-700',
  running: 'bg-blue-100 text-blue-700',
  queued: 'bg-slate-100 text-slate-600',
  discovered: 'bg-slate-100 text-slate-600',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {status}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-slate-500">Loading…</div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Thumbnail({ src, alt, size = 40 }: { src: string | null | undefined; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };

  if (!src || failed) {
    return (
      <div
        style={style}
        className="flex shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-1/2 w-1/2">
          <path
            d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm2 12 4.5-5.5 3 3.5L18 10l2 2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      style={style}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-md border border-slate-200 object-cover"
    />
  );
}

function ProfileField({
  label,
  value,
  confident,
}: {
  label: string;
  value: string | number | null | undefined;
  confident?: boolean;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <span className="max-w-full rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
      <span className="font-medium text-slate-500">{label}:</span> <span className="break-all">{value}</span>
      {confident === false && <span className="ml-1 text-amber-600" title="Inferred, not confirmed">~</span>}
    </span>
  );
}

/**
 * Read-only preview of the Kickio product profile derived for a scraped
 * item - team/season/type/condition/etc, mapped per the shirt mapping
 * guide. Nothing here is ever written to Kickio's database; it's purely
 * so an admin can see how the item would map.
 */
export function KickioProfilePanel({ profile }: { profile: KickioProfile | null | undefined }) {
  if (!profile) return null;
  const { identity, listing, custom_attributes, confidence, needs_review, review_reason, category } = profile;

  return (
    <details className="group rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-slate-500">
        <span>
          Kickio profile <span className="font-normal text-slate-400">· {category}</span>
        </span>
        {needs_review ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Needs review</span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">Mapped</span>
        )}
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <ProfileField label="Team" value={identity.team} confident={confidence.team !== 'inferred'} />
          <ProfileField
            label="Season"
            value={
              identity.extra_seasons.length > 0
                ? `${identity.season} → ${identity.extra_seasons[identity.extra_seasons.length - 1]}`
                : identity.season
            }
            confident={confidence.season !== 'inferred'}
          />
          <ProfileField label="Type" value={identity.shirt_type} confident={confidence.shirt_type !== 'inferred'} />
          <ProfileField label="Gender" value={identity.gender} />
          <ProfileField label="Player" value={identity.player} />
          <ProfileField label="Number" value={identity.number} />
          <ProfileField label="Issue" value={identity.issue} />
          <ProfileField label="Special edition" value={identity.special_edition} />
          <ProfileField label="Sleeves" value={identity.sleeves} />
          <ProfileField label="Signed" value={identity.signed} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ProfileField label="Condition" value={listing.condition} />
          <ProfileField label="Size" value={listing.size} />
          <ProfileField label="Manufacturer" value={listing.manufacturer} />
          <ProfileField label="Colour" value={listing.colour} />
          <ProfileField label="Colour 2" value={listing.colour_secondary} />
          <ProfileField label="Boxed" value={listing.boxed_edition} />
          <ProfileField
            label="Price"
            value={listing.price != null ? `${listing.price} ${listing.currency ?? ''}`.trim() : null}
            confident={confidence.price !== 'inferred'}
          />
          {listing.original_price != null && listing.original_currency && (
            <span className="max-w-full rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-400">
              ≈ {listing.original_price} {listing.original_currency}
              {listing.fx_rate_used != null && ` at ${listing.fx_rate_used}`}
            </span>
          )}
          {listing.stock_status && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                listing.stock_status === 'In Stock'
                  ? 'bg-green-100 text-green-700'
                  : listing.stock_status === 'Out of Stock'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {listing.stock_status}
            </span>
          )}
          {Object.entries(custom_attributes).map(([k, v]) => (
            <ProfileField
              key={k}
              label={k}
              value={v}
              confident={confidence[`custom_attributes.${k}`] !== 'inferred'}
            />
          ))}
        </div>
        {needs_review && review_reason && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">{review_reason}</p>
        )}
      </div>
    </details>
  );
}

export function Input({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="min-h-[2.5rem] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </label>
  );
}
