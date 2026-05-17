export class ApiError extends Error {
  constructor(status, reasonCode, message, field = undefined, code = "VALIDATION_ERROR") {
    super(message);
    this.status = status;
    this.reasonCode = reasonCode;
    this.field = field;
    this.code = code;
  }
}

export function errorBody(error) {
  return {
    error: {
      code: error.code || "VALIDATION_ERROR",
      message: error.message,
      details: [
        {
          field: error.field || "request",
          reasonCode: error.reasonCode,
          message: error.message
        }
      ]
    }
  };
}

export function fail(status, reasonCode, message, field) {
  throw new ApiError(status, reasonCode, message, field);
}
