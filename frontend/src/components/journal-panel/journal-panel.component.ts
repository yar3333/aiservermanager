import {
  Component,
  signal,
  computed,
  inject,
  effect,
  OnDestroy,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatSelectModule } from "@angular/material/select";
import { MatButtonModule } from "@angular/material/button";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { FormsModule } from "@angular/forms";
import { timer, Subscription } from "rxjs";
import { ServiceService } from "../../services/service.service";
import { SelectedServiceService } from "../../services/selected-service.service";
import { JournalLine, ServiceStatus } from "../../models/service";

/** Threshold (px): if scrollTop is within this distance of the bottom, treat as "scrolled to bottom". */
const AUTOSCROLL_THRESHOLD = 40;

@Component({
  selector: "app-journal-panel",
  standalone: true,
  imports: [CommonModule, MatCardModule, MatSelectModule, MatButtonModule, MatProgressBarModule, FormsModule],
  templateUrl: "./journal-panel.component.html",
  styleUrls: ["./journal-panel.component.scss"],
})
export class JournalPanelComponent implements OnDestroy, AfterViewInit {
  private serviceService = inject(ServiceService);
  private selectedServiceService = inject(SelectedServiceService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild("journalBody") journalBody?: ElementRef<HTMLElement>;

  readonly services = signal<ServiceStatus[]>([]);
  readonly journalLines = signal<JournalLine[]>([]);
  readonly loading = signal(true);
  readonly journalLoading = signal(false);
  readonly error = signal<string | null>(null);

  private journalSub?: Subscription;
  readonly servicesLoaded = signal(false);

  /** Currently selected service name — synced with the shared signal. */
  selectedService = computed<string | null>(() => this.selectedServiceService.selectedService());

  /** Plain-text journal content for a single `<pre>` element — no nested DOM. */
  journalText = computed(() => {
    const lines = this.journalLines();
    if (lines.length === 0) return "";
    return lines.map((l) => (l.timestamp ? `${l.timestamp} ${l.message}` : l.message)).join("\n");
  });

  constructor() {
    // Watch shared signal reactively — catches changes from dropdown, row click, edit, delete, etc.
    effect(() => {
      if (!this.servicesLoaded()) return;
      const name = this.selectedService();

      if (name) {
        this.journalLines.set([]);
        this.error.set(null);
        this.restartPolling();
      } else {
        this.stopPolling();
        this.journalLines.set([]);
      }
    });

    this.loadServices();
  }

  ngAfterViewInit(): void {
    // Scroll to bottom after first render
    this.scrollToBottom();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private loadServices(): void {
    this.loading.set(true);
    this.serviceService.fetchServices().subscribe({
      next: (services) => {
        this.services.set(services);

        // If no service is selected yet, pick the first one
        if (!this.selectedService() && services.length > 0) {
          this.selectedServiceService.select(services[0].name);
        }

        this.loading.set(false);
        this.servicesLoaded.set(true);
      },
      error: (err) => {
        this.error.set(err.message);
        this.loading.set(false);
      },
    });
  }

  onServiceChange(name: string | null): void {
    this.selectedServiceService.select(name);
  }

  private restartPolling(): void {
    this.stopPolling();
    this.fetchJournal(); // immediate first fetch
    this.journalSub = timer(0, 1000).subscribe(() => this.fetchJournal());
  }

  private stopPolling(): void {
    if (this.journalSub) {
      this.journalSub.unsubscribe();
      this.journalSub = undefined;
    }
  }

  private fetchJournal(): void {
    const name = this.selectedService();
    if (!name) return;

    this.journalLoading.set(true);
    this.serviceService.fetchJournal(name, 100).subscribe({
      next: (lines) => {
        // Remember whether user was scrolled to bottom before update
        const wasAtBottom = this.isScrolledToBottom();

        this.journalLines.set(lines);
        this.error.set(null);
        this.journalLoading.set(false);

        // After DOM update, restore scroll position
        this.cdr.markForCheck();
        requestAnimationFrame(() => {
          if (wasAtBottom) {
            this.scrollToBottom();
          }
        });
      },
      error: (err) => {
        this.error.set(err.message);
        this.journalLoading.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  private get scrollContainer(): HTMLElement | null {
    return this.journalBody?.nativeElement ?? null;
  }

  private isScrolledToBottom(): boolean {
    const el = this.scrollContainer;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTOSCROLL_THRESHOLD;
  }

  private scrollToBottom(): void {
    const el = this.scrollContainer;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
