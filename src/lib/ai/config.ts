// Which AI services are configured. Server-only.
export function aiStatus(): { photos: boolean; text: boolean } {
  return {
    photos: Boolean(process.env.OPENAI_API_KEY),
    // Claude, or OpenAI as the fallback writer.
    text: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
  }
}
