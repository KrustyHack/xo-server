import highland from 'highland'
import findIndex from 'lodash/findIndex'
import includes from 'lodash/includes'
import { fromCallback } from 'promise-toolbox'

import { NoSuchObject } from '../api-errors'
import {
  forEach,
  generateUnsecureToken,
  isEmpty,
  mapToArray,
  streamToArray,
  throwFn
} from '../utils'

// ===================================================================

class NoSuchIpPool extends NoSuchObject {
  constructor (id) {
    super(id, 'ip pool')
  }
}

const normalize = ({
  addresses,
  id = throwFn('id is a required field'),
  name = '',
  networks,
  resourceSets
}) => ({
  addresses,
  id,
  name,
  networks,
  resourceSets
})

// ===================================================================

// Note: an address cannot be in two different pools sharing a
// network.
export default class IpPools {
  constructor (xo) {
    this._store = null
    this._xo = xo

    xo.on('start', async () => {
      this._store = await xo.getStore('ipPools')
    })
  }

  async createIpPool ({ addresses, name, networks }) {
    const id = await this._generateId()

    await this._save({
      addresses,
      id,
      name,
      networks
    })

    return id
  }

  async deleteIpPool (id) {
    const store = this._store

    if (await store.has(id)) {
      return store.del(id)
    }

    throw new NoSuchIpPool(id)
  }

  getAllIpPools () {
    return streamToArray(this._store.createValueStream(), {
      mapper: normalize
    })
  }

  getIpPool (id) {
    return this._store.get(id).then(normalize, error => {
      throw error.notFound ? new NoSuchIpPool(id) : error
    })
  }

  allocIpAddresses (vifId, addAddresses, removeAddresses) {
    const promises = []
    return fromCallback(cb => {
      const xoVif = this.getObject(vifId)
      const xapi = this.getXapi(xoVif)

      const vif = xapi.getObject(xoVif._xapiId)
      const network = vif.$network
      const networkId = network.$id

      const allocAndSave = (() => {
        const resourseSetId = xapi.getData(vif.VM, 'resourseSet')

        return resourseSetId
          ? (ipPool, allocations) => this._xo.allocateLimitsInResourceSet({
            [`ipPool:${ipPool.id}`]: allocations
          }).then(() => this._save(ipPool))
          : ipPool => this._save(ipPool)
      })()

      const isVif = id => id === vifId

      highland(this._store.createValueStream()).find(ipPool => {
        const { addresses, networks } = ipPool
        if (!(addresses && networks && includes(networks, networkId))) {
          return false
        }

        let allocations = 0
        let changed = false
        forEach(removeAddresses, address => {
          let vifs, i
          if (
            (vifs = addresses[address]) &&
            (vifs = vifs.vifs) &&
            (i = findIndex(vifs, isVif)) !== -1
          ) {
            vifs.splice(i, 1)
            --allocations
            changed = true
          }
        })
        forEach(addAddresses, address => {
          const data = addresses[address]
          const vifs = data.vifs || (data.vifs = [])
          if (!includes(vifs, vifId)) {
            vifs.push(vifId)
            ++allocations
            changed = true
          }
        })

        if (changed) {
          allocations[ipPool.id] = allocations
          promises.push(allocAndSave(ipPool, allocations))
        }
      }).toCallback(cb)
    }).then(() => Promise.all(promises))
  }

  async updateIpPool (id, {
    addresses,
    name,
    networks,
    resourceSets
  }) {
    const ipPool = await this.getIpPool(id)

    name != null && (ipPool.name = name)
    if (addresses) {
      const addresses_ = ipPool.addresses || {}
      forEach(addresses, (props, address) => {
        if (props === null) {
          delete addresses_[address]
        } else {
          addresses_[address] = props
        }
      })
      if (isEmpty(addresses_)) {
        delete ipPool.addresses
      } else {
        ipPool.addresses = addresses_
      }
    }

    // TODO: Implement patching like for addresses.
    if (networks) {
      ipPool.networks = networks
    }

    // TODO: Implement patching like for addresses.
    if (resourceSets) {
      ipPool.resourceSets = resourceSets
    }

    await this._save(ipPool)
  }

  async _generateId () {
    let id
    do {
      id = generateUnsecureToken(8)
    } while (await this._store.has(id))
    return id
  }

  _save (ipPool) {
    ipPool = normalize(ipPool)
    return this._store.put(ipPool.id, ipPool)
  }
}
