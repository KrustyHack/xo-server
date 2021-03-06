import filter from 'lodash/filter'
import includes from 'lodash/includes'
import {
  hash,
  needsRehash,
  verify
} from 'hashy'

import {
  InvalidCredential,
  NoSuchObject
} from '../api-errors'
import {
  Groups
} from '../models/group'
import {
  Users
} from '../models/user'
import {
  forEach,
  isEmpty,
  lightSet,
  mapToArray,
  noop,
  pCatch
} from '../utils'

// ===================================================================

class NoSuchGroup extends NoSuchObject {
  constructor (id) {
    super(id, 'group')
  }
}

class NoSuchUser extends NoSuchObject {
  constructor (id) {
    super(id, 'user')
  }
}

const addToArraySet = (set, value) => set && !includes(set, value)
  ? set.concat(value)
  : [ value ]
const removeFromArraySet = (set, value) => set && filter(set, current => current !== value)

// ===================================================================

export default class {
  constructor (xo) {
    this._xo = xo

    const redis = xo._redis

    this._groups = new Groups({
      connection: redis,
      prefix: 'xo:group'
    })
    const users = this._users = new Users({
      connection: redis,
      prefix: 'xo:user',
      indexes: ['email']
    })

    xo.on('start', async () => {
      if (!await users.exists()) {
        const email = 'admin@admin.net'
        const password = 'admin'

        await this.createUser(email, {password, permission: 'admin'})
        console.log('[INFO] Default user created:', email, ' with password', password)
      }
    })
  }

  // -----------------------------------------------------------------

  async createUser (email, { password, ...properties }) {
    if (password) {
      properties.pw_hash = await hash(password)
    }

    // TODO: use plain objects
    const user = await this._users.create(email, properties)

    return user.properties
  }

  async deleteUser (id) {
    const user = await this.getUser(id)

    await this._users.remove(id)

    // Remove tokens of user.
    this._xo.getAuthenticationTokensForUser(id)
      .then(tokens => {
        forEach(tokens, token => {
          this._xo.deleteAuthenticationToken(id)::pCatch(noop)
        })
      })
      ::pCatch(noop) // Ignore any failures.

    // Remove ACLs for this user.
    this._xo.getAclsForSubject(id).then(acls => {
      forEach(acls, acl => {
        this._xo.removeAcl(id, acl.object, acl.action)::pCatch(noop)
      })
    })

    // Remove the user from all its groups.
    forEach(user.groups, groupId => {
      this.getGroup(groupId)
        .then(group => this._removeUserFromGroup(id, group))
        ::pCatch(noop) // Ignore any failures.
    })
  }

  async updateUser (id, {
    // TODO: remove
    email,

    name = email,
    password,
    permission,
    preferences
  }) {
    const user = await this.getUser(id)

    if (name) {
      user.name = name
    }
    if (permission) {
      user.permission = permission
    }
    if (password) {
      user.pw_hash = await hash(password)
    }

    const newPreferences = { ...user.preferences }
    forEach(preferences, (value, name) => {
      if (value == null) {
        delete newPreferences[name]
      } else {
        newPreferences[name] = value
      }
    })
    user.preferences = isEmpty(newPreferences)
      ? undefined
      : newPreferences

    // TODO: remove
    user.email = user.name
    delete user.name

    await this._users.save(user)
  }

  // Merge this method in getUser() when plain objects.
  async _getUser (id) {
    const user = await this._users.first(id)
    if (!user) {
      throw new NoSuchUser(id)
    }

    return user
  }

  // TODO: this method will no longer be async when users are
  // integrated to the main collection.
  async getUser (id) {
    const user = (await this._getUser(id)).properties

    // TODO: remove when no longer the email property has been
    // completely eradicated.
    user.name = user.email

    return user
  }

  async getAllUsers () {
    return this._users.get()
  }

  async getUserByName (username, returnNullIfMissing) {
    // TODO: change `email` by `username`.
    const user = await this._users.first({ email: username })
    if (user) {
      return user.properties
    }

    if (returnNullIfMissing) {
      return null
    }

    throw new NoSuchUser(username)
  }

  // Get or create a user associated with an auth provider.
  async registerUser (provider, name) {
    let user = await this.getUserByName(name, true)
    if (user) {
      if (user._provider !== provider) {
        throw new Error(`the name ${name} is already taken`)
      }

      return user
    }

    if (!this._xo._config.createUserOnFirstSignin) {
      throw new Error(`registering ${name} user is forbidden`)
    }

    return /* await */ this.createUser(name, {
      _provider: provider
    })
  }

  async changeUserPassword (userId, oldPassword, newPassword) {
    if (!(await this.checkUserPassword(userId, oldPassword, false))) {
      throw new InvalidCredential()
    }

    await this.updateUser(userId, { password: newPassword })
  }

  async checkUserPassword (userId, password, updateIfNecessary = true) {
    const { pw_hash: hash } = await this.getUser(userId)
    if (!(
      hash &&
      await verify(password, hash)
    )) {
      return false
    }

    if (updateIfNecessary && needsRehash(hash)) {
      await this.updateUser(userId, { password })
    }

    return true
  }

  // -----------------------------------------------------------------

  async createGroup ({name}) {
    // TODO: use plain objects.
    const group = (await this._groups.create(name)).properties

    group.users = JSON.parse(group.users)
    return group
  }

  async deleteGroup (id) {
    const group = await this.getGroup(id)

    await this._groups.remove(id)

    // Remove ACLs for this group.
    this._xo.getAclsForSubject(id).then(acls => {
      forEach(acls, acl => {
        this._xo.removeAcl(id, acl.object, acl.action)::pCatch(noop)
      })
    })

    // Remove the group from all its users.
    forEach(group.users, userId => {
      this.getUser(userId)
        .then(user => this._removeGroupFromUser(id, user))
        ::pCatch(noop) // Ignore any failures.
    })
  }

  async updateGroup (id, {name}) {
    const group = await this.getGroup(id)

    if (name) group.name = name

    await this._groups.save(group)
  }

  async getGroup (id) {
    const group = await this._groups.first(id)
    if (!group) {
      throw new NoSuchGroup(id)
    }

    return group.properties
  }

  async getAllGroups () {
    return this._groups.get()
  }

  async addUserToGroup (userId, groupId) {
    const [user, group] = await Promise.all([
      this.getUser(userId),
      this.getGroup(groupId)
    ])

    user.groups = addToArraySet(user.groups, groupId)
    group.users = addToArraySet(group.users, userId)

    await Promise.all([
      this._users.save(user),
      this._groups.save(group)
    ])
  }

  async _removeUserFromGroup (userId, group) {
    group.users = removeFromArraySet(group.users, userId)
    return this._groups.save(group)
  }

  async _removeGroupFromUser (groupId, user) {
    user.groups = removeFromArraySet(user.groups, groupId)
    return this._users.save(user)
  }

  async removeUserFromGroup (userId, groupId) {
    const [user, group] = await Promise.all([
      this.getUser(userId),
      this.getGroup(groupId)
    ])

    await Promise.all([
      this._removeUserFromGroup(userId, group),
      this._removeGroupFromUser(groupId, user)
    ])
  }

  async setGroupUsers (groupId, userIds) {
    const group = await this.getGroup(groupId)

    let newUsersIds = lightSet(userIds)
    const oldUsersIds = []
    forEach(group.users, id => {
      if (newUsersIds.has(id)) {
        newUsersIds.delete(id)
      } else {
        oldUsers.push(id)
      }
    })
    newUsersIds = newUsersIds.toArray()

    const getUser = ::this.getUser
    const [newUsers, oldUsers] = await Promise.all([
      Promise.all(newUsersIds.map(getUser)),
      Promise.all(oldUsersIds.map(getUser))
    ])

    forEach(newUsers, user => {
      user.groups = addToArraySet(user.groups, groupId)
    })
    forEach(oldUsers, user => {
      user.groups = removeFromArraySet(user.groups, groupId)
    })

    group.users = userIds

    const saveUser = ::this._users.save
    await Promise.all([
      Promise.all(mapToArray(newUsers, saveUser)),
      Promise.all(mapToArray(oldUsers, saveUser)),
      this._groups.save(group)
    ])
  }
}
