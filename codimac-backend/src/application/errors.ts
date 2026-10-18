export type ApplicationErrorCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR"

export interface ApplicationErrorField {
  field: string
  code: string
  message: string
}

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly fields: ApplicationErrorField[] = [],
  ) {
    super(message)
    this.name = "ApplicationError"
  }
}
