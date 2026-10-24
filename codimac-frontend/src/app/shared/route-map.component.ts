import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from "@angular/core"
import {
  crearMapaRuta,
  type MapaRuta,
  type ParadaMapa,
  type PuntoMapa,
} from "../../adaptadores/mapas/leaflet-mapa-ruta"

/** Mapa de solo vista con el almacén y las paradas numeradas en su orden de visita (RF-02.10). */
@Component({
  selector: "codimac-route-map",
  standalone: true,
  template: `
    <div #canvas class="route-map-canvas" role="img" [attr.aria-label]="ariaLabel"></div>
    <ol class="visually-hidden">@for (stop of stops; track stop.sequence) {<li>{{ stop.sequence }}. {{ stop.label }}{{ stop.status ? " · " + stop.status : "" }}</li>}</ol>
  `,
})
export class RouteMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() warehouse: PuntoMapa | null = null
  @Input() stops: ParadaMapa[] = []
  @ViewChild("canvas", { static: true }) private readonly canvas!: ElementRef<HTMLDivElement>
  private map: MapaRuta | null = null
  private drawnKey = ""

  get ariaLabel(): string {
    return `Mapa de la ruta con ${this.stops.length} ${this.stops.length === 1 ? "parada" : "paradas"} desde el almacén`
  }

  ngAfterViewInit(): void {
    this.map = crearMapaRuta(this.canvas.nativeElement)
    this.draw()
  }

  ngOnChanges(): void {
    this.draw()
  }

  /** Las listas llegan como arreglos nuevos en cada detección de cambios: solo se redibuja si cambió el contenido. */
  private draw(): void {
    if (!this.map) return
    const key = JSON.stringify([this.warehouse, this.stops])
    if (key === this.drawnKey) return
    this.drawnKey = key
    this.map.dibujar(this.warehouse, this.stops)
  }

  ngOnDestroy(): void {
    this.map?.destruir()
  }
}
