/** Code-built worker looks. Future categories register their own catalog and visual factories. */
export const FICTIONAL_CHARACTERS = [
  ['naruto', 'Naruto'], ['pikachu', 'Pikachu'], ['goku', 'Goku'], ['mario', 'Mario'],
  ['luigi', 'Luigi'], ['sonic', 'Sonic'], ['totoro', 'Totoro'], ['spongebob', 'SpongeBob'],
  ['luffy', 'Luffy'], ['doraemon', 'Doraemon'], ['kirby', 'Kirby'], ['link', 'Link'],
  ['yoshi', 'Yoshi'], ['stitch', 'Stitch'], ['baymax', 'Baymax'], ['shrek', 'Shrek'],
  ['batman', 'Batman'], ['spider-man', 'Spider-Man'], ['deadpool', 'Deadpool'], ['darth-vader', 'Darth Vader'],
] as const;
export type FictionalCharacter = typeof FICTIONAL_CHARACTERS[number][0];
export type AppearanceCategory = 'original' | 'fictional';
export type WorkerAppearanceId = 'original' | FictionalCharacter;
export interface AppearanceConfig { categories: AppearanceCategory[]; characters: FictionalCharacter[] }
export interface AppearanceState { config: AppearanceConfig; assignments: Record<string, WorkerAppearanceId> }
export const defaultAppearanceConfig = (): AppearanceConfig => ({ categories: ['original'], characters: FICTIONAL_CHARACTERS.map(([id]) => id) });
export const defaultAppearanceState = (): AppearanceState => ({ config: defaultAppearanceConfig(), assignments: {} });
export function isFictionalCharacter(value: unknown): value is FictionalCharacter { return FICTIONAL_CHARACTERS.some(([id]) => id === value); }
export function validAppearanceConfig(value: unknown): value is AppearanceConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as AppearanceConfig;
  return Array.isArray(v.categories) && v.categories.length > 0 && v.categories.every(c => c === 'original' || c === 'fictional')
    && new Set(v.categories).size === v.categories.length && Array.isArray(v.characters)
    && v.characters.every(isFictionalCharacter) && new Set(v.characters).size === v.characters.length
    && (!v.categories.includes('fictional') || v.characters.length > 0);
}
