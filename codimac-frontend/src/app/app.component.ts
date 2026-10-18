import { Component } from "@angular/core"
import { AppStateService } from "./core/app-state.service"
import { IconComponent } from "./shared/icon.component"
import { AdminFeatureComponent } from "./features/admin/admin-feature.component"
import { AccessFeatureComponent } from "./features/access/access-feature.component"
import { ClientFeatureComponent } from "./features/client/client-feature.component"
import { DispatcherFeatureComponent } from "./features/dispatcher/dispatcher-feature.component"
import { DriverFeatureComponent } from "./features/driver/driver-feature.component"
import { AppShellComponent } from "./layout/app-shell.component"
import { FormDialogComponent } from "./layout/form-dialog.component"

@Component({
  selector: "codimac-root",
  standalone: true,
  imports: [
    AppShellComponent,
    FormDialogComponent,
    IconComponent,
    DispatcherFeatureComponent,
    AdminFeatureComponent,
    DriverFeatureComponent,
    ClientFeatureComponent,
    AccessFeatureComponent,
  ],
  template: `
    @if (state.role() === "Despachador") {
      <codimac-shell>
        <codimac-dispatcher />
      </codimac-shell>
    } @else if (state.role() === "Administrador") {
      <codimac-shell>
        <codimac-admin />
      </codimac-shell>
    } @else if (state.role() === "Chofer") {
      <codimac-driver />
    } @else if (state.role() === "Cliente") {
      <codimac-client />
    } @else {
      <codimac-access />
    }
    @if (state.dialog()) {
      <codimac-form-dialog />
    }
    @if (state.toast()) {
      <div class="toast" role="status">
        <codimac-icon name="check" [size]="18" /> {{ state.toast() }}
      </div>
    }
  `,
})
export class AppComponent {
  constructor(readonly state: AppStateService) {}
}
