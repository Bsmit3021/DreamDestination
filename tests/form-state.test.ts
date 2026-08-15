import { describe, expect, it } from "vitest";

import {
  IDLE_FORM_STATE,
  type FormState,
  collectValues,
  valueFor,
} from "@/lib/forms";

/**
 * React 19 clears uncontrolled inputs once a form action settles, so a
 * rejected submission has to be re-populated from the returned state. These
 * cover that mechanism, including the rule that passwords never travel in it.
 */

describe("collectValues", () => {
  it("collects only the requested fields", () => {
    const formData = new FormData();
    formData.set("email", "person@example.com");
    formData.set("password", "super-secret");
    formData.set("occupation", "Nurse");

    const values = collectValues(formData, ["email", "occupation"]);

    expect(values).toEqual({
      email: "person@example.com",
      occupation: "Nurse",
    });
  });

  it("never includes a password unless explicitly asked for", () => {
    const formData = new FormData();
    formData.set("email", "person@example.com");
    formData.set("password", "super-secret");
    formData.set("confirmPassword", "super-secret");

    const values = collectValues(formData, ["email"]);

    expect(Object.values(values)).not.toContain("super-secret");
    expect(values).not.toHaveProperty("password");
    expect(values).not.toHaveProperty("confirmPassword");
  });

  it("skips absent fields rather than inventing empty strings", () => {
    const formData = new FormData();
    formData.set("email", "person@example.com");

    expect(collectValues(formData, ["email", "missing"])).toEqual({
      email: "person@example.com",
    });
  });
});

describe("valueFor", () => {
  const errorState: FormState = {
    status: "error",
    fieldErrors: { householdSize: ["nope"] },
    values: { occupation: "Echoed", householdSize: "0" },
  };

  it("prefers the echoed submission over the saved value", () => {
    expect(valueFor(errorState, "occupation", "Saved")).toBe("Echoed");
  });

  it("keeps an echoed zero rather than treating it as absent", () => {
    expect(valueFor(errorState, "householdSize", 4)).toBe("0");
  });

  it("falls back to the saved value when nothing was echoed", () => {
    expect(valueFor(errorState, "currentCity", "Denver")).toBe("Denver");
  });

  it("falls back to the saved value on a fresh form", () => {
    expect(valueFor(IDLE_FORM_STATE, "occupation", "Saved")).toBe("Saved");
  });

  it("returns an empty string when there is nothing to show", () => {
    expect(valueFor(IDLE_FORM_STATE, "occupation", null)).toBe("");
    expect(valueFor(IDLE_FORM_STATE, "occupation", undefined)).toBe("");
  });

  it("ignores echoed values from a success state", () => {
    const success: FormState = { status: "success", message: "Saved" };

    expect(valueFor(success, "occupation", "Saved")).toBe("Saved");
  });
});
