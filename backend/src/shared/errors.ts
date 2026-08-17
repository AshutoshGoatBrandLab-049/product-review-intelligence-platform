export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class ProductionSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSafetyError";
  }
}
