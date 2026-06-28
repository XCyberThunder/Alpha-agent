import { openBuilderWindow } from '@renderer/services/project-builder'

export const buildAnimatedWebsite = async (prompt: string) => {
  try {
    await openBuilderWindow({ prompt, autoStart: true })
    return 'Builder open kar diya. Coding Agent website prompt par kaam kar raha hai.'
  } catch {
    return 'Website Builder route abhi unavailable hai.'
  }
}
