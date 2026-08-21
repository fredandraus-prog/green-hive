export type FeatureFlagState = 'OFF' | 'INTERNAL' | 'BETA' | 'PUBLIC';
export interface FeatureFlag { readonly code: string; readonly state: FeatureFlagState; }
