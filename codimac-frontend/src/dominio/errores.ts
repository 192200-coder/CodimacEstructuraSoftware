export class ReglaNegocioError extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
  ) {
    super(message)
    this.name = "ReglaNegocioError"
  }
}
