import { describe, it, expect } from "vitest";
import { PRODUCT_IDENTITY } from "./identity";
import { newPetState } from "../sim/state";

describe("PRODUCT_IDENTITY", () => {
  it("has the expected NYRC product identity", () => {
    expect(PRODUCT_IDENTITY.id).toBe("nyrc");
    expect(PRODUCT_IDENTITY.shortName).toBe("NYRC");
    expect(PRODUCT_IDENTITY.fullName).toBe("Not Your Regular Companion");
  });

  it("provides a default companion name", () => {
    expect(PRODUCT_IDENTITY.defaultCompanionName).toBe("NYRC");
  });

  it("newPetState uses the default companion name from identity config", () => {
    const pet = newPetState();
    expect(pet.name).toBe(PRODUCT_IDENTITY.defaultCompanionName);
  });

  it("newPetState still accepts a custom name override", () => {
    const pet = newPetState("Nova");
    expect(pet.name).toBe("Nova");
  });
});
