export interface FeatureFlags {
  newDashboard: boolean;
  betaSearch: boolean;
  aiReview: boolean;
}

export type FeatureFlagOverrides = Partial<Record<keyof FeatureFlags, boolean | undefined>>;

export function resolveFeatureFlags(
  defaults: FeatureFlags,
  accountOverrides: FeatureFlagOverrides = {},
  userOverrides: FeatureFlagOverrides = {}
): FeatureFlags {
  return {
    ...defaults,
    ...accountOverrides,
    ...userOverrides
  } as FeatureFlags;
}
