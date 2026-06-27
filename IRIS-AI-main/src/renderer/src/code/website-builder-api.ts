import { createBuilderProject, openBuilderWindow } from '@renderer/services/project-builder'

export const buildAnimatedWebsite = async (prompt: string) => {
  try {
    const res = await createBuilderProject(prompt, 'glm')

    if (res.success && res.state) {
      await openBuilderWindow({
        state: res.state,
        previewHtml: res.previewHtml,
        prompt,
        providerError: res.providerError
      })
      if (res.providerError) return res.providerError
      return `Website Builder ready. Project saved at ${res.state.metadata.projectPath}.`
    }

    return res.message || res.error || 'Website Builder project generate nahi kar paya.'
  } catch {
    return 'Website Builder route abhi unavailable hai.'
  }
}
