import { Component } from "@angular/core"
import { AppStateService } from "../../core/app-state.service"
import { ClientsPageComponent } from "./clients-page.component"
import { DashboardPageComponent } from "./dashboard-page.component"
import { HistoryPageComponent } from "./history-page.component"
import { InventoryPageComponent } from "./inventory-page.component"
import { OrdersPageComponent } from "./orders-page.component"
import { RoutesPageComponent } from "./routes-page.component"

@Component({
  selector: "codimac-dispatcher",
  standalone: true,
  imports: [
    DashboardPageComponent,
    OrdersPageComponent,
    InventoryPageComponent,
    ClientsPageComponent,
    RoutesPageComponent,
    HistoryPageComponent,
  ],
  template: `
    @switch (state.active()) {
      @case ("Panel") { <codimac-dashboard-page /> }
      @case ("Pedidos") { <codimac-orders-page /> }
      @case ("Inventario") { <codimac-inventory-page /> }
      @case ("Clientes") { <codimac-clients-page /> }
      @case ("Repartos") { <codimac-routes-page /> }
      @case ("Historial") { <codimac-history-page /> }
      @default { <codimac-dashboard-page /> }
    }
  `,
})
export class DispatcherFeatureComponent {
  constructor(readonly state: AppStateService) {}
}
