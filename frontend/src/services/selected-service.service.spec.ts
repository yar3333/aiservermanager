import { TestBed } from "@angular/core/testing";
import { SelectedServiceService } from "./selected-service.service";

describe("SelectedServiceService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with a null selection", () => {
    const service = TestBed.inject(SelectedServiceService);
    expect(service.selectedService()).toBeNull();
  });

  it("persists the selection to localStorage", () => {
    const service = TestBed.inject(SelectedServiceService);
    service.select("llama-server");
    expect(service.selectedService()).toBe("llama-server");
    expect(localStorage.getItem("journal-selected-service")).toBe('"llama-server"');
  });

  it("restores a saved selection", () => {
    localStorage.setItem("journal-selected-service", '"comfyui"');
    const service = TestBed.inject(SelectedServiceService);
    expect(service.selectedService()).toBe("comfyui");
  });

  it("treats corrupt localStorage values as no selection", () => {
    localStorage.setItem("journal-selected-service", "{oops");
    const service = TestBed.inject(SelectedServiceService);
    expect(service.selectedService()).toBeNull();
  });

  it("selecting null clears the selection", () => {
    localStorage.setItem("journal-selected-service", '"nginx"');
    const service = TestBed.inject(SelectedServiceService);
    service.select(null);
    expect(service.selectedService()).toBeNull();
    expect(localStorage.getItem("journal-selected-service")).toBe("null");
  });
});
