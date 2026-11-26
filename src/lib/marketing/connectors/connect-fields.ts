// VYRA Marketing hub (ZP-1200): what each of the newer connectors reads from the saved (decrypted) credentials,
// and from the channel row. Used by the Connect form when it is wired up; no secrets here.
export interface ConnectField { key: string; label: string; secret: boolean; help: string }
export interface ConnectFieldsDef { credentials: readonly ConnectField[]; externalId?: { label: string; help: string }; config?: readonly { key: string; help: string }[] }

export const CONNECT_FIELDS: Readonly<Record<string, ConnectFieldsDef>> = {
  PINTEREST: {
    credentials: [{ key: 'accessToken', label: 'Access token', secret: true, help: 'From your Pinterest app (scopes boards:read, pins:read, pins:write, user_accounts:read).' }],
    externalId: { label: 'Board ID', help: 'The board the pins go to.' },
  },
  TELEGRAM: {
    credentials: [{ key: 'botToken', label: 'Bot token', secret: true, help: 'From @BotFather.' }],
    externalId: { label: 'Channel', help: 'The channel @username or its numeric chat ID. The bot must be an administrator.' },
  },
  X: {
    credentials: [{ key: 'accessToken', label: 'OAuth 2.0 user token', secret: true, help: 'Scopes tweet.read tweet.write users.read media.write offline.access.' }],
  },
  YOUTUBE: {
    credentials: [
      { key: 'clientId', label: 'Client ID', secret: false, help: 'Google Cloud OAuth client.' },
      { key: 'clientSecret', label: 'Client secret', secret: true, help: 'Google Cloud OAuth client.' },
      { key: 'refreshToken', label: 'Refresh token', secret: true, help: 'Granted with the youtube.upload and youtube.readonly scopes.' },
    ],
    config: [{ key: 'privacy', help: 'private, unlisted (default) or public.' }, { key: 'videoUrl', help: 'https link to the video file when the post has none attached.' }],
  },
  TIKTOK: {
    credentials: [{ key: 'accessToken', label: 'Access token', secret: true, help: 'User token with scopes video.upload and user.info.basic.' }],
    config: [{ key: 'videoUrl', help: 'https link to the video.' }, { key: 'uploadMode', help: '"file" uploads the bytes instead of letting TikTok pull from a verified domain.' }],
  },
}
