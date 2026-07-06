import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { Gpu } from './models/gpu';
import { GpuService } from './services/gpu.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatTableModule,
    MatProgressBarModule,
    MatCardModule,
    MatChipsModule,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  private gpuService = inject(GpuService);

  displayedColumns: string[] = [
    'index',
    'vendor',
    'brand',
    'name',
    'vulkanName',
    'vram',
    'usage',
    'temperature',
    'pciBusId',
  ];

  gpus: Gpu[] = [];
  loading = true;
  error: string | null = null;

  ngOnInit(): void {
    this.gpuService.watchGpus().subscribe({
      next: (data) => {
        this.gpus = data;
        this.loading = false;
        this.error = null;
      },
      error: (err) => {
        this.error = `Failed to fetch GPU data: ${err.message}`;
        this.loading = false;
      },
    });
  }

  vramPercent(gpu: Gpu): number {
    if (gpu.vramTotal === 0) return 0;
    return Math.round((gpu.vramUsed / gpu.vramTotal) * 100);
  }

  colorForUsage(usage: number): string {
    if (usage < 40) return '#4caf50';
    if (usage < 75) return '#ff9800';
    return '#f44336';
  }

  colorForTemp(temp: number): string {
    if (temp < 60) return '#4caf50';
    if (temp < 80) return '#ff9800';
    return '#f44336';
  }
}
