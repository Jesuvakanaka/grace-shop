// Which AI services are configured. Server-only.
export function aiStatus(): { photos: boolean; text: boolean } {
  return {
    photos: Boolean(process.env.OPENAI_API_KEY),
    text: Boolean(process.env.ANTHROPIC_API_KEY),
  }
}
