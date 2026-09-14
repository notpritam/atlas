import './platform-icon.css';

const symbols = { chrome: 'chrome', ios: 'app-store-ios', android: 'google-play' } as const;

/** Published Font Awesome brand artwork, shared by platform links and headings. */
export function PlatformIcon({ platform }: { platform: keyof typeof symbols }) {
  return <svg className="platform-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <use href={`/assets/platforms/icons.svg#${symbols[platform]}`} width="24" height="24" />
  </svg>;
}
