import { useEffect, useState } from 'react';

/** Evento no estándar de Chrome/Android para lanzar el diálogo de instalación. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'renfe:install-hint-dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS se presenta como Mac con pantalla táctil.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Aviso para añadir la web a la pantalla de inicio.
 * Android/Chrome: botón que abre el diálogo de instalación del sistema.
 * iOS/Safari: no hay API, así que se explica el gesto (Compartir → Añadir a pantalla de inicio).
 */
export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(() => isStandalone() || wasDismissed());

  useEffect(() => {
    if (hidden) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (isIos()) setShowIos(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [hidden]);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sin almacenamiento: se volverá a mostrar la próxima vez */
    }
  };

  if (hidden || (!deferred && !showIos)) return null;

  return (
    <div className="install-hint" role="note">
      <img src="./icon-192.png" alt="" width="36" height="36" />
      <div className="install-text">
        <strong>Tenla a mano</strong>
        {deferred ? (
          <span>Añádela a tu pantalla de inicio y ábrela como una app.</span>
        ) : (
          <span>
            Pulsa <ShareIcon /> <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>.
          </span>
        )}
      </div>
      {deferred && (
        <button
          className="install-btn"
          onClick={async () => {
            await deferred.prompt();
            const { outcome } = await deferred.userChoice;
            setDeferred(null);
            if (outcome === 'accepted') setHidden(true);
          }}
        >
          Instalar
        </button>
      )}
      <button className="icon-btn" onClick={dismiss} aria-label="Cerrar aviso" title="No volver a mostrar">
        ✕
      </button>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-label="icono de compartir" className="share-icon">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
