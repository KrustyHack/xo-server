// TODO: Prevent token connections from creating tokens.
// TODO: Token permission.
export async function create () {
  const userId = this.session.get('user_id')
  return (await this.createAuthenticationToken({userId})).id
}

create.description = 'create a new authentication token'

create.permission = '' // sign in

// -------------------------------------------------------------------

// TODO: an user should be able to delete its own tokens.
async function delete_ ({token: id}) {
  await this.deleteAuthenticationToken(id)
}

export {delete_ as delete}

delete_.description = 'delete an existing authentication token'

delete_.permission = 'admin'

delete_.params = {
  token: { type: 'string' }
}
