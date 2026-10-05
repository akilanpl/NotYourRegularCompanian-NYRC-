/**
 * Central product and companion identity.
 *
 * PRODUCT_IDENTITY.id / shortName / fullName describe the *application*.
 * The companion's instance name lives in PetState.name and can be anything
 * the user chooses during onboarding. The default is provided here so every
 * initialization site draws from one source of truth.
 */
export const PRODUCT_IDENTITY = {
  /** Machine-safe slug used in identifiers and paths. */
  id: "nyrc",
  /** Short display name for the application. */
  shortName: "NYRC",
  /** Expanded product name for about screens and documentation. */
  fullName: "Not Your Regular Companion",
  /** Default companion instance name for new installations. */
  defaultCompanionName: "NYRC",
} as const;
