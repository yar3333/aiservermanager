import { Component, forwardRef, inject, Input, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ControlValueAccessor, FormBuilder, FormGroup, NG_VALUE_ACCESSOR, ReactiveFormsModule } from "@angular/forms";
import { MatAutocompleteModule } from "@angular/material/autocomplete";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { ServiceService, AutocompleteSuggestion } from "../../../services/service.service";
import { Subscription, of } from "rxjs";
import { debounceTime, distinctUntilChanged, switchMap, catchError } from "rxjs/operators";

@Component({
  selector: "app-file-autocomplete",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule],
  templateUrl: "./file-autocomplete.component.html",
  styleUrls: ["./file-autocomplete.component.scss"],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FileAutocompleteComponent),
      multi: true,
    },
  ],
})
export class FileAutocompleteComponent implements ControlValueAccessor {
  private fb = inject(FormBuilder);
  private service = inject(ServiceService);

  @Input() label = "Path";
  @Input() placeholder = "/path/to/file";
  @Input() required = false;
  /** Pre-populated suggestions shown when the input is empty. */
  @Input() existingPaths: string[] = [];

  // ControlValueAccessor callbacks
  private onChange = (_value: string) => {};
  private onTouched = () => {};
  private _subscription: Subscription | null = null;

  /** Suggestions as a signal — triggers change detection on update. */
  readonly suggestions = signal<AutocompleteSuggestion[]>([]);

  /** Inner form group for the autocomplete input only. */
  readonly innerForm: FormGroup = this.fb.group({
    value: [""],
  });

  writeValue(value: string): void {
    const normalized = (value ?? "").toString();
    this.innerForm.patchValue({ value: normalized }, { emitEvent: false });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    if (isDisabled) this.innerForm.disable();
    else this.innerForm.enable();
  }

  ngOnInit(): void {
    // Propagate value changes immediately
    this._subscription = this.innerForm.get("value")!.valueChanges.subscribe((val: string) => {
      this.onChange(val);
    });

    // Fetch suggestions with debounce
    this._subscription.add(
      this.innerForm
        .get("value")!
        .valueChanges.pipe(
          debounceTime(200),
          distinctUntilChanged(),
          switchMap((val: string) => {
            const trimmed = (val ?? "").trim();
            if (!trimmed) {
              return of(this.emptySuggestions);
            }
            return this.service
              .getLlamaAutocomplete("path", trimmed)
              .pipe(catchError(() => of<AutocompleteSuggestion[]>([])));
          }),
        )
        .subscribe((result) => {
          this.suggestions.set(result);
        }),
    );
  }

  /** Suggestions derived from existingPaths — shown when input is empty. */
  private get emptySuggestions(): AutocompleteSuggestion[] {
    return this.existingPaths.filter(Boolean).map((p) => ({ path: p, source: "existing config" }));
  }

  ngOnDestroy(): void {
    this._subscription?.unsubscribe();
  }

  /** Called when user selects a suggestion from the dropdown. */
  onSelect(value: string): void {
    this.innerForm.patchValue({ value }, { emitEvent: false });
    this.onChange(value);
  }

  onBlur(): void {
    this.onTouched();
  }
}
