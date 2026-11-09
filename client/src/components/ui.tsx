import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { UtilStatus } from '../../../shared/engine';
import type { Health, Priority } from '../../../shared/schedule';

// ---------------- toast ----------------
type ToastFn = (msg: string, kind?: 'ok' | 'error') => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback<ToastFn>((msg, kind = 'ok') => {
    setToast({ msg, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <span className="dot-ok" style={toast.kind === 'error' ? { background: 'var(--danger)' } : undefined} />
          <span>{toast.msg}</span>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---------------- modal ----------------
interface ModalApi { open: (node: ReactNode) => void; close: () => void }
const ModalCtx = createContext<ModalApi>({ open: () => {}, close: () => {} });
export const useModal = () => useContext(ModalCtx);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode>(null);
  const close = useCallback(() => setNode(null), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <ModalCtx.Provider value={{ open: setNode, close }}>
      {children}
      <div className={'modal-overlay' + (node ? ' show' : '')} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        {node && <div className="modal-box" role="dialog" aria-modal="true">{node}</div>}
      </div>
    </ModalCtx.Provider>
  );
}

export function ModalFrame({ title, children, footer, wide }: { title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { close } = useModal();
  useEffect(() => {
    const box = document.querySelector('.modal-box') as HTMLElement | null;
    if (box) box.style.maxWidth = wide ? '900px' : '640px';
  }, [wide]);
  return (
    <>
      <div className="modal-header"><h3>{title}</h3><button className="modal-close" aria-label="Close" onClick={close}>✕</button></div>
      <div className="modal-body">{children}</div>
      <div className="modal-footer">{footer}<button className="btn btn-ghost btn-sm" onClick={close}>Close</button></div>
    </>
  );
}

export function Confirm({ title, message, confirmLabel, danger, onConfirm }: { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<unknown> | void }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(false);
  return (
    <ModalFrame title={title} footer={
      <button className={'btn btn-sm ' + (danger ? 'btn-danger-outline' : 'btn-primary')} disabled={busy}
        onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); close(); }}>{confirmLabel}</button>
    }>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{message}</div>
    </ModalFrame>
  );
}

// ---------------- small pieces ----------------
export function Avatar({ text, size = 26 }: { text: string; size?: number }) {
  return <div className="avatar" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36), flexShrink: 0 }}>{text}</div>;
}

export function Stat({ value, label, color, onClick }: { value: ReactNode; label: string; color?: string; onClick?: () => void }) {
  return (
    <div className="stat-chip" style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      <div className="sv" style={color ? { color } : undefined}>{value}</div>
      <div className="sl">{label}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function Card({ title, sub, children, style, className }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={'card ' + (className ?? '')} style={style}>
      {(title || sub) && <div className="panel-head"><span className="panel-title">{title}</span>{sub && <span className="panel-sub">{sub}</span>}</div>}
      {children}
    </div>
  );
}

export function PageHead({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="section-head"><div className="section-title">{title}</div>{children}</div>
      {desc && <div className="section-desc">{desc}</div>}
    </>
  );
}

export const healthClass = (h: Health | string) => (h === 'Complete' ? 'tag-ok' : h === 'Delayed' ? 'tag-danger' : h === 'About to Close' ? 'tag-warn' : 'tag-neutral');
export const priorityClass = (p: Priority) => (p === 'High' ? 'tag-danger' : p === 'Medium' ? 'tag-warn' : 'tag-neutral');
export const statusClass = (s: UtilStatus) => (s === 'Overutilized' ? 'tag-danger' : s === 'At Capacity' ? 'tag-warn' : s === 'Optimal' ? 'tag-ok' : 'tag-neutral');
export const statusColor = (s: UtilStatus) =>
  s === 'Overutilized' ? 'var(--danger)' : s === 'At Capacity' ? 'var(--warn)' : s === 'Optimal' ? 'var(--accent)' : s === 'Underutilized' ? 'var(--lavender)' : 'var(--text-faint)';

export function Tag({ className, children }: { className: string; children: ReactNode }) {
  return <span className={'tag ' + className}>{children}</span>;
}

export function ListRow({ icon, title, desc, right, onClick }: { icon?: ReactNode; title: ReactNode; desc?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  return (
    <div className="alert-item" style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      {icon !== undefined && <div className="alert-ic" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>{icon}</div>}
      <div style={{ flex: 1, minWidth: 0 }}><div className="alert-title">{title}</div>{desc && <div className="alert-desc">{desc}</div>}</div>
      {right}
    </div>
  );
}

export const fmtDate = (s: string | Date, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) =>
  (typeof s === 'string' ? new Date(s.length === 10 ? s + 'T00:00:00Z' : s) : s).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
