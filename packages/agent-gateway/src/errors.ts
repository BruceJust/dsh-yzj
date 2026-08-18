export class YzjDeliveryOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super('Yunzhijia Agent reply delivery outcome is unknown', { cause })
    this.name = 'YzjDeliveryOutcomeUnknownError'
  }
}

export class YzjTaskLeaseRevokedError extends Error {
  constructor() {
    super('Yunzhijia Agent task lease is no longer active')
    this.name = 'YzjTaskLeaseRevokedError'
  }
}
