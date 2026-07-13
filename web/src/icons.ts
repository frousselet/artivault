// Inline stroke icons (24×24, currentColor). Sized via CSS `.icon`.

const ICONS: Record<string, string> = {
  menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
  brand: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  artifacts:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
  admin: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 8-4-.5-7-3.5-7-8V6z"/><path d="M9 12l2 2 4-4"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
};

export function icon(name: string, cls = 'icon'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}
