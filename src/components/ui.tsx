"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X, Plus, Inbox } from "lucide-react";

/* ── Drawer ── */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 scrim-enter"
        style={{ background: "var(--scrim)" }}
        onClick={onClose}
      />
      <div
        className="absolute right-0 top-0 bottom-0 bg-surface border-l border-line drawer-enter flex flex-col"
        style={{ width, boxShadow: "var(--shadow-drawer)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h3 className="text-[15px] font-medium tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink p-1 -mr-1 rounded"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ── Modal (centered) ── */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 scrim-enter"
        style={{ background: "var(--scrim)" }}
        onClick={onClose}
      />
      <div
        className="relative bg-surface border border-line rounded-lg modal-enter flex flex-col max-h-[90vh]"
        style={{ width: "100%", maxWidth: width, boxShadow: "var(--shadow-drawer)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h3 className="text-[15px] font-medium tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink p-1 -mr-1 rounded"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── PageHeader ── */
export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-8">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-mute mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/* ── TextField ── */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  type = "text",
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      {label && (
        <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">
          {label}
        </span>
      )}
      <input
        type={type}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[14px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2"
      />
    </label>
  );
}

/* ── TextArea ── */
export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      {label && (
        <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">
          {label}
        </span>
      )}
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[14px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2 resize-none"
      />
    </label>
  );
}

/* ── BulletTextArea — Enter inserts a new bullet line ── */
export function BulletTextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const el  = ref.current!;
      const pos = el.selectionStart;
      const val = el.value;
      const next = val.slice(0, pos) + "\n" + val.slice(pos);
      onChange(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(pos + 1, pos + 1);
        resize(el);
      });
    }
  }

  const lines    = value.split("\n").filter((l) => l.trim());
  const isBullet = lines.length >= 2;

  return (
    <label className="block">
      {label && (
        <span className="block text-[11px] font-medium uppercase tracking-wider text-mute mb-2">
          {label}
        </span>
      )}
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => { onChange(e.target.value); resize(e.target); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-bg border border-line rounded-md px-3 py-2 text-[14px] text-ink placeholder:text-mute focus:outline-none focus:border-line2 focus:bg-surface2 resize-none"
      />
    </label>
  );
}

/* ── PrimaryButton ── */
export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="bg-accent text-white text-[13px] font-medium px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

/* ── GhostButton ── */
export function GhostButton({
  children,
  onClick,
  icon: Icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[13px] text-dim hover:text-ink border border-line hover:border-line2 rounded-md px-3 py-1.5 bg-surface"
    >
      {Icon && <Icon size={14} strokeWidth={1.5} />}
      {children}
    </button>
  );
}

/* ── FAB ── */
export function FAB({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label ?? "Add"}
      className="fixed bottom-8 right-8 z-30 w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center hover:scale-105 active:scale-95"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <Plus size={20} strokeWidth={2} />
    </button>
  );
}

/* ── Pill ── */
export function Pill({
  children,
  onRemove,
}: {
  children: ReactNode;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] bg-surface2 text-dim border border-line">
      {children}
      {onRemove && (
        <button onClick={onRemove} className="text-mute hover:text-ink -mr-0.5">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

/* ── EmptyState ── */
export function EmptyState({
  icon: Icon = Inbox,
  line,
}: {
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  line: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 gap-3">
      <div className="text-mute">
        <Icon size={28} strokeWidth={1.25} />
      </div>
      <p className="text-[13px] text-mute">{line}</p>
    </div>
  );
}
