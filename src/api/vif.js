import forEach from 'lodash/forEach'

import {
  diffItems,
  noop,
  pCatch
} from '../utils'

// ===================================================================

// TODO: move into vm and rename to removeInterface
async function delete_ ({vif}) {
  this.allocIpAddresses(
    vif.id,
    vif.$network,
    null,
    vif.allowedIpv4Addresses.concat(vif.allowedIpv6Addresses)
  )::pCatch(noop)

  await this.getXapi(vif).deleteVif(vif._xapiId)
}
export {delete_ as delete}

delete_.params = {
  id: { type: 'string' }
}

delete_.resolve = {
  vif: ['id', 'VIF', 'administrate']
}

// -------------------------------------------------------------------

// TODO: move into vm and rename to disconnectInterface
export async function disconnect ({vif}) {
  // TODO: check if VIF is attached before
  await this.getXapi(vif).disconnectVif(vif._xapiId)
}

disconnect.params = {
  id: { type: 'string' }
}

disconnect.resolve = {
  vif: ['id', 'VIF', 'operate']
}

// -------------------------------------------------------------------
// TODO: move into vm and rename to connectInterface
export async function connect ({vif}) {
  // TODO: check if VIF is attached before
  await this.getXapi(vif).connectVif(vif._xapiId)
}

connect.params = {
  id: { type: 'string' }
}

connect.resolve = {
  vif: ['id', 'VIF', 'operate']
}

// -------------------------------------------------------------------

export async function set ({
  vif,
  network,
  mac,
  allowedIpv4Addresses,
  allowedIpv6Addresses,
  attached
}) {
  if (network || mac) {
    const xapi = this.getXapi(vif)

    const vm = xapi.getObject(vif.$VM)
    mac == null && (mac = vif.MAC)
    network = xapi.getObject(network && network.id || vif.$network)
    allowedIpv4Addresses == null && (allowedIpv4Addresses = vif.allowedIpv4Addresses)
    allowedIpv6Addresses == null && (allowedIpv6Addresses = vif.allowedIpv6Addresses)
    attached == null && (attached = vif.attached)

    // remove previous VIF
    const dealloc = address => {
      this.deallocIpAddress(address, vif.id)::pCatch(noop)
    }
    forEach(vif.allowedIpv4Addresses, dealloc)
    forEach(vif.allowedIpv6Addresses, dealloc)
    xapi.deleteVif(vif._xapiId)::pCatch(noop)

    // create new VIF with new parameters
    await xapi.createVif(vm.$id, network.$id, {
      mac,
      currently_attached: attached
    })

    return
  }

  const [ addAddresses, removeAddresses ] = diffItems(
    allowedIpv4Addresses.concat(allowedIpv6Addresses),
    vif.allowedIpv4Addresses.concat(vif.allowedIpv6Addresses)
  )
  this.allocIpAddresses(
    vif.id,
    addAddresses,
    removeAddresses
  )::pCatch(noop)

  return this.getXapi(vif).editVif(vif._xapiId, {
    ipv4Allowed: allowedIpv4Addresses,
    ipv6Allowed: allowedIpv6Addresses
  })
}

set.params = {
  id: { type: 'string' },
  network: { type: 'string', optional: true },
  mac: { type: 'string', optional: true },
  allowedIpv4Addresses: {
    type: 'array',
    items: {
      type: 'string'
    },
    optional: true
  },
  allowedIpv6Addresses: {
    type: 'array',
    items: {
      type: 'string'
    },
    optional: true
  },
  attached: { type: 'boolean', optional: true }
}

set.resolve = {
  vif: ['id', 'VIF', 'operate'],
  network: ['network', 'network', 'operate']
}
