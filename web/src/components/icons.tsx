/** Calendario: abre el horario de todo el día de la estación. */
export const CALENDAR = (
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" className="cal-icon">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
    <path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

/** Tren de cercanías visto de frente (el mismo dibujo que el del tren seguido en el mapa). */
export const TRAIN_PATH =
  'M12 2C8 2 5 2.5 5 6v9.5A3.5 3.5 0 0 0 8.5 19L7 20.5v.5h2.2l2-2h1.6l2 2H17v-.5L15.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3-4-7-4Zm-5 5h4.2v4H7V7Zm5.8 0H17v4h-4.2V7ZM8.5 14a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z';

/** Autobús visto de frente. */
export const BUS_PATH =
  'M7 2h10a3 3 0 0 1 3 3v11.5a2 2 0 0 1-1 1.73V20.5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1V19h-7v1.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-2.27A2 2 0 0 1 4 16.5V5a3 3 0 0 1 3-3Zm-1 5.5V12h12V7.5H6Zm1.75 7a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm8.5 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM8.5 3.75a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Z';

export const TrainIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="currentColor" d={TRAIN_PATH} />
  </svg>
);

export const BusIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="currentColor" d={BUS_PATH} />
  </svg>
);
