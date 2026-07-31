export interface DefaultCategorySeed {
  name: string;
  icon?: string;
  color?: string;
}

export const DEFAULT_CATEGORIES: DefaultCategorySeed[] = [
  { name: 'Comida', icon: 'utensils', color: '#f97316' },
  { name: 'Transporte', icon: 'car', color: '#3b82f6' },
  { name: 'Hogar', icon: 'home', color: '#22c55e' },
  { name: 'Ocio', icon: 'gamepad-2', color: '#a855f7' },
  { name: 'Salud', icon: 'heart-pulse', color: '#ef4444' },
  { name: 'Suscripciones', icon: 'repeat', color: '#6366f1' },
  { name: 'Educación', icon: 'graduation-cap', color: '#14b8a6' },
  { name: 'Ropa', icon: 'shirt', color: '#ec4899' },
  { name: 'Otros', icon: 'ellipsis', color: '#64748b' },
];
