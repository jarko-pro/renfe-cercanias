/** Prefijo del route_id (2 dígitos) -> núcleo de Cercanías. */
const NETWORKS: Record<string, string> = {
  '10': 'Madrid',
  '20': 'Asturias',
  '30': 'Sevilla',
  '31': 'Cádiz',
  '32': 'Málaga',
  '40': 'Valencia',
  '41': 'Murcia/Alicante',
  '45': 'Cartagena',
  '46': 'Ferrol',
  '47': 'León',
  '51': 'Rodalies de Catalunya',
  '60': 'Bilbao',
  '61': 'San Sebastián',
  '62': 'Santander',
  '70': 'Zaragoza',
};

export function networkOf(routeId: string): string {
  return NETWORKS[routeId.slice(0, 2)] ?? 'Cercanías';
}
