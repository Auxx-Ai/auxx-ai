import fs from 'fs/promises'
import path from 'path'
import { complete, errored } from '../errors.js'
import { HIDDEN_AUXX_DIRECTORY } from '../constants/hidden-auxx-directory.js'
const GITIGNORE_FILENAME = '.gitignore'
const GITIGNORE_CONTENT = `node_modules
graphql.d.ts
${HIDDEN_AUXX_DIRECTORY}
.DS_Store
`

export async function generateGitignore() {
  const rootDirAbsolute = path.resolve('.')
  const gitignoreFilePath = path.join(rootDirAbsolute, GITIGNORE_FILENAME)
  try {
    const gitignoreContent = await fs.readFile(gitignoreFilePath, 'utf-8')
    const gitignoreLines = gitignoreContent.split(/\r?\n/)
    if (!gitignoreLines.includes(HIDDEN_AUXX_DIRECTORY)) {
      try {
        await fs.appendFile(gitignoreFilePath, '\n' + HIDDEN_AUXX_DIRECTORY + '\n')
      } catch {
        return errored({ code: 'FAILED_TO_ADD_HIDDEN_FILES_TO_GITIGNORE' })
      }
    }
    return complete(undefined)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      try {
        await fs.writeFile(GITIGNORE_FILENAME, GITIGNORE_CONTENT)
      } catch {
        return errored({ code: 'FAILED_TO_CREATE_GITIGNORE' })
      }
      return complete(undefined)
    }
    return errored({ code: 'FAILED_TO_READ_GITIGNORE' })
  }
}
