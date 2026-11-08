const OPERATOR_VALUE = Symbol("value");

export class DataFieldOperator {
  /** @param {unknown} [value] */
  constructor(value) {
    /** @type {any} */ (this)[OPERATOR_VALUE] = value;
  }

  /** @param {unknown} value */
  static get(value) {
    return value instanceof DataFieldOperator ? /** @type {any} */ (value)[OPERATOR_VALUE] : value;
  }
}

export class ForcedDeletion extends DataFieldOperator {
  constructor() {
    super();
  }
}

export class ForcedReplacement extends DataFieldOperator {}

export const dataFieldOperators = Object.freeze({ DataFieldOperator, ForcedDeletion, ForcedReplacement });
