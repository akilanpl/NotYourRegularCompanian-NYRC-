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

it("uses standalone executable, bundle and renderer identities", async () => {
 const {readFile,access}=await import("node:fs/promises");
 const config=JSON.parse(await readFile("src-tauri/tauri.conf.json","utf8"));
 expect(config.productName).toBe("NYRC");expect(config.identifier).toBe("com.nyrc.companion");
 const cargo=await readFile("src-tauri/Cargo.toml","utf8");expect(cargo).toContain('name = "nyrc"');expect(cargo).toContain('name = "nyrc_lib"');
 expect(await readFile("src-tauri/src/main.rs","utf8")).toContain("nyrc_lib::run()");
 await access("src/lib/components/SpriteRenderer.svelte");await access("public/sprites/companion-idle.png");
 expect(await readFile("src/styles.css","utf8")).toContain("--nyrc-text");
});
