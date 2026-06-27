export type YouTubeRouteResult = {
  intent: 'open' | 'search'
  query: string
  url: string
}

const YOUTUBE_HOME = 'https://www.youtube.com'

const YOUTUBE_HOME_PATTERNS = [
  /\b(open youtube|youtube open|youtube kholo|youtube khol do|youtube open karo|yt open)\b/i,
  /\bzara youtube kholo\b/i
]

const SEARCH_NOISE = /\b(youtube|yt|pe|par|open|kholo|khol|karo|search|dhoondo|dhundo|chalao|video)\b/gi

const collapseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim()

export const extractYouTubeQuery = (input: string) =>
  collapseSpaces(
    input
      .toLowerCase()
      .replace(SEARCH_NOISE, ' ')
  )

export const getYouTubeUrlFromIntent = (intent: 'open' | 'search', query = '') => {
  const cleanedQuery = collapseSpaces(query)
  if (intent === 'search' && cleanedQuery) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanedQuery)}`
  }
  return YOUTUBE_HOME
}

export const getYouTubeUrl = (input: string): YouTubeRouteResult | null => {
  const lower = collapseSpaces(input.toLowerCase())
  if (!/\b(youtube|yt)\b/.test(lower)) return null

  const explicitHome = YOUTUBE_HOME_PATTERNS.some((pattern) => pattern.test(lower))
  const hasQueryFrame =
    /\b(youtube|yt)\b\s+(pe|par)\s+.+\b(open|kholo|khol|search|dhoondo|dhundo)\b/.test(lower) ||
    /\b(youtube|yt)\b\s+search\b/.test(lower)
  const hasSearchIntent = /\b(search|dhoondo|dhundo)\b/.test(lower)

  const query = extractYouTubeQuery(lower)
  if (!explicitHome && (hasQueryFrame || hasSearchIntent) && query) {
    return {
      intent: 'search',
      query,
      url: getYouTubeUrlFromIntent('search', query)
    }
  }

  return {
    intent: 'open',
    query: '',
    url: YOUTUBE_HOME
  }
}
