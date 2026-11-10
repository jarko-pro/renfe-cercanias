import { useState } from 'react';

/**
 * Aviso general (huelgas, cortes…) que se muestra al abrir la app.
 * Se cierra con ✕ hasta la próxima vez que se abra (sessionStorage) y desaparece solo al pasar `until`.
 * Para quitarlo o cambiarlo, edita NOTICE (o ponlo a null).
 */
const NOTICE: { id: string; title: string; text: string; until: string } | null = {
  id: 'huelga-maquinistas-2026-11',
  title: 'Huelga de maquinistas hasta el 12 de noviembre',
  text: 'Hay servicios mínimos: algunos trenes del horario pueden no salir aunque aparezcan como «Programado» o «Sin confirmar». Fíate más de los que tienen dato en directo. Un tren con mucho retraso que sigue parado en su estación de origen puede no llegar a salir.',
  // Fin del 12 de noviembre, hora peninsular.
  until: '2026-11-13T00:00:00+01:00',
};

const key = (id: string) => `renfe:notice-closed:${id}`;

function isClosed(id: string): boolean {
  try {
    return sessionStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}

export function useNotice() {
  const active = NOTICE && Date.now() < Date.parse(NOTICE.until) ? NOTICE : null;
  const [closed, setClosed] = useState(() => !active || isClosed(active.id));
  const close = () => {
    setClosed(true);
    try {
      if (active) sessionStorage.setItem(key(active.id), '1');
    } catch {
      /* sin almacenamiento: solo se cierra en esta vista */
    }
  };
  return { notice: closed ? null : active, close };
}

export function NoticeCard({ notice, onClose }: { notice: NonNullable<typeof NOTICE>; onClose: () => void }) {
  return (
    <div className="notice-card" role="alert">
      <span className="notice-icon" aria-hidden="true">
        ⚠
      </span>
      <div className="notice-text">
        <strong>{notice.title}</strong>
        <span>{notice.text}</span>
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Cerrar aviso" title="Cerrar">
        ✕
      </button>
    </div>
  );
}
