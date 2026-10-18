import { Component, Input } from "@angular/core"

const iconPaths: Record<string, string[]> = {
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M3 14h7v7H3z", "M14 14h7v7h-7z"],
  box: ["m4 7 8-4 8 4-8 4-8-4Z", "m4 7 8 4 8-4v10l-8 4-8-4V7Z", "M12 11v10"],
  checkCircle: ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "m9 11 3 3L22 4"],
  checkCheck: ["m18 6-7 7-3-3", "m22 10-7.5 7.5-3-3"],
  warehouse: ["m3 10 9-7 9 7v11H3V10Z", "M7 21v-7h10v7M7 10h.01M12 10h.01M17 10h.01"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"],
  truck: ["M10 17h4V5H2v12h3", "M14 8h4l4 4v5h-3M14 17h1", "M10 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z", "M20 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"],
  history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5M12 7v5l3 2"],
  search: ["M18 11a7 7 0 1 0-14 0 7 7 0 0 0 14 0Z", "m20 20-4-4"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"],
  plus: ["M12 5v14M5 12h14"],
  route: ["M8 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z", "M20 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z", "M8 19h3a3 3 0 0 0 3-3V8a3 3 0 0 1 3-3"],
  clock: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", "M12 7v5l3 2"],
  arrow: ["m9 18 6-6-6-6"],
  check: ["m5 12 4 4L19 6"],
  pin: ["M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z", "M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"],
  user: ["M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M4 21a8 8 0 0 1 16 0"],
  chevron: ["m9 18 6-6-6-6"],
  menu: ["M4 7h16M4 12h16M4 17h16"],
  close: ["m6 6 12 12M18 6 6 18"],
  xCircle: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "m15 9-6 6m0-6 6 6"],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 1 1 8 0v4", "M12 15v2"],
  phone: ["M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.69 2.79a2 2 0 0 1-.45 2.11L8.08 9.91a16 16 0 0 0 6 6l1.29-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.57 2.79.69a2 2 0 0 1 1.73 2.04Z"],
  alertTriangle: ["M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z", "M12 9v4", "M12 17h.01"],
}

@Component({
  selector: "codimac-icon",
  standalone: true,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @for (path of paths; track $index) {
        <path [attr.d]="path" />
      }
    </svg>
  `,
})
export class IconComponent {
  @Input() name = "grid"
  @Input() size = 20

  get paths(): string[] {
    return iconPaths[this.name] ?? iconPaths["grid"]
  }
}
