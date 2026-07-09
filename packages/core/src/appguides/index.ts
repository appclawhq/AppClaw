/**
 * AppGuide — per-app knowledge injected into the agent's context.
 *
 * Built-in guides live in this file (keyed by package name / bundle ID).
 * Custom guides live in .appclaw/guides/<appId>.md — they take priority over built-ins,
 * so users can override or extend any guide without touching source code.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface AppGuide {
  name: string;
  content: string;
}

const GUIDES: Record<string, AppGuide> = {
  // ── Gmail ─────────────────────────────────────────────────────────────
  'com.google.android.gm': {
    name: 'Gmail',
    content: `## Gmail Navigation
- Hamburger menu (top-left) → folders (Inbox, Sent, Drafts, Trash, All Mail)
- Compose button: floating pencil/+ button at bottom-right
- Swipe right on an email → Archive; swipe left → Delete

## Searching
- Tap the search bar at the top; supports filters:
  from:sender@example.com | to:user@example.com | subject:keyword | has:attachment | is:unread

## Common Actions
- Archive: swipe right on the email row
- Delete: swipe left on the email row
- Select multiple: long-press an email to enter selection mode
- Star: tap the star icon next to the email
- Mark read/unread: long-press → select → tap the envelope icon

## Composing
- Tap the floating compose button (bottom-right pencil icon)
- Fill To / Subject / Body; attach via paperclip icon; send via paper-plane icon (top-right)

## Tips
- Primary / Social / Promotions tabs separate email categories
- Labels and filters are in Settings → account → Filters and Blocked Addresses`,
  },

  'com.google.gmail': {
    name: 'Gmail (iOS)',
    content: `## Gmail Navigation (iOS)
- Tap the three-line menu (top-left) for folders
- Compose: red pencil button bottom-right
- Swipe left on an email for Archive / Trash options

## Searching
- Search bar at top; same filters: from: to: subject: has:attachment is:unread

## Composing
- Tap the pencil button (bottom-right)
- Add recipients, subject, body; attach via paperclip; send via paper-plane icon`,
  },

  // ── YouTube ───────────────────────────────────────────────────────────
  'com.google.android.youtube': {
    name: 'YouTube',
    content: `## YouTube Navigation
- Bottom nav: Home | Shorts | + (upload) | Subscriptions | Library
- Search: magnifying-glass icon (top-right)
- Tap a video thumbnail to play; double-tap left/right to seek ±10 s

## Searching
- Tap the search icon → type query → press Enter or tap the search icon again
- Filter results: tap "Filters" after searching

## Common Actions
- Like: thumbs-up under the video
- Subscribe: red Subscribe button under/beside the channel name
- Save to playlist: tap ⋮ menu on a video → Save to playlist
- Share: tap the Share button under the video

## Playback
- Full screen: rotate device or tap the expand icon (bottom-right of player)
- Quality: tap ⋮ inside player → Quality
- Captions: tap CC icon inside player`,
  },

  'com.google.ios.youtube': {
    name: 'YouTube (iOS)',
    content: `## YouTube Navigation (iOS)
- Bottom nav: Home | Shorts | + | Subscriptions | Library
- Search: tap the search icon (top-right)
- Tap a thumbnail to play; double-tap sides to seek

## Common Actions
- Like: thumbs-up below video
- Subscribe: Subscribe button next to channel name
- Save: tap ⋮ on a video → Save to playlist`,
  },

  // ── WhatsApp ──────────────────────────────────────────────────────────
  'com.whatsapp': {
    name: 'WhatsApp',
    content: `## WhatsApp Navigation
- Bottom tabs: Chats | Updates | Communities | Calls
- New chat: floating pencil/message icon (bottom-right)
- Search: magnifying-glass icon at the top of Chats

## Messaging
- Open a chat → type in the message bar at the bottom → send via arrow icon
- Attach media: paperclip icon next to message bar
- Voice note: long-press the microphone icon
- Emoji/stickers: smiley face icon on the left of message bar

## Common Actions
- Star a message: long-press message → star icon
- Forward: long-press message → forward arrow
- Delete: long-press message → trash icon
- Group info: tap the group name at the top of the chat`,
  },

  'net.whatsapp.WhatsApp': {
    name: 'WhatsApp (iOS)',
    content: `## WhatsApp Navigation (iOS)
- Bottom tabs: Chats | Updates | Communities | Calls
- New chat: pencil icon (top-right)
- Search: pull down on Chats list

## Messaging
- Open chat → message bar → send with arrow
- Attach: + icon to the left of the message bar`,
  },

  // ── Chrome ────────────────────────────────────────────────────────────
  'com.android.chrome': {
    name: 'Chrome',
    content: `## Chrome Navigation
- Address bar at the top: tap to type a URL or search query, then press Enter
- Back/forward: use device back button or long-press back for history
- Tabs: square icon (top-right) shows open tabs; tap + to open a new tab
- Menu: three-dot icon (top-right) for bookmarks, history, settings, etc.

## Common Actions
- Bookmark: three-dot menu → Bookmark (star) or tap the star in the address bar
- Share: three-dot menu → Share
- Find in page: three-dot menu → Find in page
- Refresh: circular arrow in the address bar (or pull down on the page)
- Incognito tab: three-dot menu → New Incognito Tab`,
  },

  'com.google.chrome': {
    name: 'Chrome (iOS)',
    content: `## Chrome Navigation (iOS)
- Address bar at top: tap → type URL or search → Go
- Tabs: tab count button (bottom-right)
- Three-dot menu (bottom-right) for bookmarks, history, settings`,
  },

  // ── Settings ──────────────────────────────────────────────────────────
  'com.android.settings': {
    name: 'Android Settings',
    content: `## Settings Navigation
- Use the search bar at the top to find any setting by keyword
- Main sections: Network & internet | Connected devices | Apps | Battery | Display | Sound | Storage | Security | Privacy | Location | Accounts | Accessibility | System

## Common Paths
- Wi-Fi: Network & internet → Internet
- Bluetooth: Connected devices → Connection preferences → Bluetooth
- Notification settings: Notifications (top-level or via Apps → app name)
- App permissions: Apps → (app name) → Permissions
- Developer options: System → Developer options (enable via Build number tap ×7)`,
  },

  'com.apple.Preferences': {
    name: 'iOS Settings',
    content: `## iOS Settings Navigation
- Search bar at the top of the settings list — fastest way to find any setting
- Main sections: Wi-Fi | Bluetooth | Cellular | Notifications | Sounds | Focus | Screen Time | General | Display | Accessibility | Privacy & Security | App Store | Wallet | Passwords | (installed apps at the bottom)

## Common Paths
- Wi-Fi: Settings → Wi-Fi → toggle or select network
- Bluetooth: Settings → Bluetooth
- App notifications: Settings → Notifications → (app name)
- Location services: Settings → Privacy & Security → Location Services
- Battery: Settings → Battery`,
  },

  // ── Instagram ─────────────────────────────────────────────────────────
  'com.instagram.android': {
    name: 'Instagram',
    content: `## Instagram Navigation
- Bottom nav: Home | Search | Reels | Shop | Profile
- Stories: circular avatars at the top of the Home feed; tap to view, swipe left/right to navigate
- Create post: tap + button (center of bottom nav or top-right) → Photo/Video/Reel/Story

## Searching
- Tap the Search icon (magnifying glass) → type username, hashtag, or keyword
- Explore tab shows trending content; filter by top, accounts, audio, tags, places

## Common Actions
- Like: double-tap a photo or tap the heart icon
- Comment: tap the speech bubble icon under a post
- Share/DM: tap the paper-plane icon → select a contact or copy link
- Save to collection: tap the bookmark icon (bottom-right of post)
- Follow: tap the Follow button on a profile or next to a username in search

## Profile
- Tap profile icon (bottom-right) to view your profile
- Edit profile: tap Edit Profile button
- Settings: three-line menu (top-right) → Settings and privacy

## Stories & Reels
- Swipe up on a story to reply or react
- Tap the screen to skip to next story; swipe right for previous
- Reels: full-screen vertical videos; like/comment/share same as posts`,
  },

  'com.burbn.instagram': {
    name: 'Instagram (iOS)',
    content: `## Instagram Navigation (iOS)
- Bottom nav: Home | Search | Reels | Shop | Profile
- Stories: avatars at top of Home feed; tap to play
- Create: tap + (top or center nav) → choose media type

## Common Actions
- Like: double-tap or tap the heart icon
- Comment: tap speech bubble icon
- Share: tap paper-plane icon
- Save: tap bookmark icon
- Follow: Follow button on profile or search result

## Stories
- Tap to advance, swipe right to go back
- Swipe up to reply`,
  },

  // ── Twitter / X ───────────────────────────────────────────────────────
  'com.twitter.android': {
    name: 'X (Twitter)',
    content: `## X Navigation
- Bottom nav: Home | Search | Spaces | Notifications | Messages
- Post: blue feather/+ button (bottom-right)
- Profile & settings: tap your avatar (top-left) to open the side drawer

## Timeline & Searching
- Home feed: Following tab (curated) or For You tab (algorithmic)
- Search: tap the magnifying-glass icon → type keyword, hashtag, or @username
- Advanced search: add "filter:media", "from:user", or "until:2024-01-01" in query

## Common Actions
- Like: heart icon under a post
- Repost (Retweet): repost icon → Repost or Quote
- Reply: speech bubble icon
- Bookmark: share icon → Bookmark (or long-press the bookmark)
- Follow: Follow button on a profile or in search results
- Mute/Block: tap ⋯ on a post or profile → Mute / Block

## Composing
- Tap the + / feather button
- Thread: tap + after writing first post to add more
- Media: tap the photo icon to attach images/GIFs/videos
- Mention: type @username; hashtag: type #topic`,
  },

  'com.atebits.Tweetie2': {
    name: 'X (Twitter) (iOS)',
    content: `## X Navigation (iOS)
- Bottom nav: Home | Search | Spaces | Notifications | Messages
- Post: tap the feather/+ button (bottom-right)
- Drawer: tap your avatar (top-left) for profile and settings

## Common Actions
- Like: heart icon under post
- Repost: repost icon → Repost or Quote
- Reply: speech bubble icon
- Bookmark: share icon → Bookmark
- Follow: Follow button on profile`,
  },

  // ── LinkedIn ──────────────────────────────────────────────────────────
  'com.linkedin.android': {
    name: 'LinkedIn',
    content: `## LinkedIn Navigation
- Bottom nav: Home | My Network | Post | Notifications | Jobs
- Search: magnifying-glass at the top; search people, jobs, companies, posts
- Messaging: chat bubble icon (top-right)

## Feed & Content
- Home feed shows posts from connections and followed topics
- Like (reactions): hold the thumbs-up to pick a reaction
- Comment: tap the comment icon
- Repost / Share: tap the share icon → Repost or Share

## Connections & Networking
- Connect: tap Connect on a profile; add a note when prompted
- Follow: Follow a creator without connecting
- My Network tab: manage invitations, find people you may know

## Jobs
- Jobs tab → search by title/location; tap Apply (Easy Apply fills from profile)
- Save a job: bookmark icon on the listing
- Filter jobs: tap All Filters → job type, date posted, experience level, etc.

## Profile
- Tap your avatar (top-left) or the Me icon → View Profile
- Edit: tap the pencil icon on each section (headline, experience, education)`,
  },

  'com.linkedin.LinkedIn': {
    name: 'LinkedIn (iOS)',
    content: `## LinkedIn Navigation (iOS)
- Bottom nav: Home | My Network | Post | Notifications | Jobs
- Search: tap the search bar at the top
- Messages: chat icon (top-right)

## Common Actions
- Like/React: hold thumbs-up for reaction picker
- Comment: comment icon
- Connect: Connect button on a profile
- Apply for job: Jobs tab → find listing → Apply / Easy Apply`,
  },

  // ── Spotify ───────────────────────────────────────────────────────────
  'com.spotify.music': {
    name: 'Spotify',
    content: `## Spotify Navigation
- Bottom nav: Home | Search | Your Library
- Now Playing bar: appears at the bottom above the nav bar; tap to expand the full player
- Mini-player: swipe down from full player or tap the chevron (top-left)

## Searching
- Search tab → type artist, song, album, podcast, or playlist
- Browse categories: scroll down in Search for genre/mood tiles

## Playback Controls
- Play/Pause: large circle button in the centre of the full player
- Next/Previous: forward/backward skip buttons
- Shuffle: crossed-arrows icon (bottom-left of full player); tap to toggle
- Repeat: circular-arrow icon (bottom-right); cycles off → repeat all → repeat one
- Like/Save track: heart icon in the full player or next to a track row
- Add to queue: tap ⋮ next to a track → Add to queue

## Library
- Your Library: saved albums, playlists, artists, and podcasts
- Create playlist: + button in Your Library
- Download for offline: toggle the download icon on a playlist or album

## Common Actions
- Follow artist: Open artist page → tap Follow button
- Share: tap ⋮ on a track/album/playlist → Share`,
  },

  'com.spotify.client': {
    name: 'Spotify (iOS)',
    content: `## Spotify Navigation (iOS)
- Bottom nav: Home | Search | Your Library
- Now Playing: bar at bottom; tap to expand full player
- Swipe down to minimise player

## Common Actions
- Play/Pause: large button in full player
- Shuffle: crossed-arrows icon (bottom-left)
- Like track: heart icon
- Add to queue: ⋮ next to track → Add to queue
- Download: toggle download icon on playlist/album`,
  },

  // ── Amazon Shopping ───────────────────────────────────────────────────
  'com.amazon.mShop.android.shopping': {
    name: 'Amazon Shopping',
    content: `## Amazon Navigation
- Bottom nav: Home | Search | Cart | Menu
- Search bar at the top: type product name, ASIN, or brand
- Hamburger menu (top-left) → All Departments, Orders, Account & Lists

## Searching & Filtering
- Tap the search bar → type query → press Enter
- After results load: tap the filter/sort icon to narrow by Price, Brand, Prime, Rating, etc.
- Department filter: tap All (next to search bar) before searching to scope to a category

## Product Page
- Scroll down for product images (swipe images left/right), description, reviews
- Select size/color variants before adding to cart
- Buy Now: immediately proceeds to checkout
- Add to Cart: adds item; tap Cart icon (top-right) to review

## Cart & Checkout
- Cart icon (top-right) → Proceed to checkout → select address → payment → Place Order
- Apply coupon/promo: tap the coupon checkbox on the product page or in the cart

## Orders & Returns
- Menu → Returns & Orders (top of Menu drawer)
- Track order: tap the order → Track Package
- Return: tap the order → Return or Replace Items`,
  },

  'com.amazon.Amazon': {
    name: 'Amazon Shopping (iOS)',
    content: `## Amazon Navigation (iOS)
- Bottom nav: Home | Search | Cart | Menu
- Search bar at top; tap All to filter by department
- Menu (bottom-right) → Orders, Account & Lists, Returns

## Common Actions
- Search: tap search bar → type query → Search
- Add to cart: Add to Cart button on product page
- Buy Now: immediate checkout
- Track order: Menu → Returns & Orders → tap order → Track Package`,
  },

  // ── Google Maps ───────────────────────────────────────────────────────
  'com.google.android.apps.maps': {
    name: 'Google Maps',
    content: `## Google Maps Navigation
- Search bar at the top: type address, place, or business name
- Bottom sheet: tap a place on the map to see its info card; swipe up for details
- Layers: stacked squares icon (top-right) for satellite, terrain, transit overlays

## Getting Directions
- Tap a place → Directions → choose mode (car, transit, walking, cycling, ride)
- Enter origin if not using current location
- Tap a route to preview; tap Start to begin turn-by-turn navigation
- During navigation: tap ⋮ for report incident, change route, or settings

## Searching & Exploring
- Tap the search bar → type destination or category (e.g., "coffee near me")
- Nearby: tap the Explore tab for restaurants, hotels, events, trending places
- Saved places: tap Saved (bottom nav) for starred/want-to-go lists

## Common Actions
- Save a place: tap the place card → Save → choose list (Starred, Want to go, custom)
- Share location: tap your avatar (top-right) → Location sharing
- Download offline map: search an area → tap the place name → ⋮ → Download offline map
- Street View: drag the person icon from the layers panel onto a road`,
  },

  'com.google.Maps': {
    name: 'Google Maps (iOS)',
    content: `## Google Maps Navigation (iOS)
- Search bar at top; tap to type address or place name
- Tap a pin/card → Directions → choose mode → Start

## Common Actions
- Get directions: tap Directions on place card → select travel mode → Start
- Save place: tap place card → Save → choose list
- Explore nearby: Explore tab (bottom nav)
- Share ETA: during navigation → share icon`,
  },

  // ── Netflix ───────────────────────────────────────────────────────────
  'com.netflix.mediaclient': {
    name: 'Netflix',
    content: `## Netflix Navigation
- Bottom nav: Home | New & Hot | My Netflix (or Downloads on some versions)
- Profile switcher: tap the profile icon (top-right) to switch profiles
- Search: magnifying-glass icon (top of Home or in the nav bar)

## Browsing & Searching
- Home feed: rows by genre, trending, continue watching
- Search: tap the search icon → type title, actor, director, or genre keyword
- Tap a title card to open details; scroll down for episodes, trailers, similar titles

## Watching
- Tap Play or the title to start
- During playback: tap screen to show controls; skip intro button appears top-right
- Episode list: while playing → tap the episode icon or list icon (for series)
- Audio/subtitles: tap the dialog icon or ⋮ in the player
- Download: tap the download icon on a title card or in the episode list (for offline)

## My Netflix
- Continue Watching: resume partially watched titles
- My List: add titles here by tapping + on any title card
- Downloads: titles saved for offline playback`,
  },

  'com.netflix.Netflix': {
    name: 'Netflix (iOS)',
    content: `## Netflix Navigation (iOS)
- Bottom nav: Home | New & Hot | My Netflix
- Search: magnifying-glass icon (top-right of Home)
- Profile: tap profile icon (top-right) to switch

## Watching
- Tap a title → Play
- Tap screen during playback for controls
- Skip intro: button appears top-right during intros
- Download: download icon on title card or episode list`,
  },

  // ── Uber ──────────────────────────────────────────────────────────────
  'com.ubercab': {
    name: 'Uber',
    content: `## Uber Navigation
- Home screen shows a map with your current location
- "Where to?" search bar at the bottom centre — tap to enter a destination

## Booking a Ride
- Tap "Where to?" → type or select a destination
- Choose pickup point (defaults to current location; drag pin or type address to change)
- Browse ride options (UberX, Comfort, XL, Black) — scroll left/right
- Tap a ride type to see price and ETA; tap Select to confirm
- Add stops: tap + add stop in the destination search
- Payment: shown at bottom; tap to switch payment method
- Confirm: tap the confirm button to book

## During a Ride
- Track driver on the map; ETA and driver info shown in the bottom sheet
- Contact driver: phone/chat icon
- Share trip: tap Share Status to send your ETA to a contact
- Cancel: tap ⋮ or the X while waiting (cancellation fee may apply)

## Common Actions
- Schedule a ride: "Where to?" → tap the clock icon for a future time
- Saved places: tap account (bottom-right) → Saved places → add Home/Work
- Trip history: account → Trips
- Activity / Receipts: account → Activity`,
  },

  'com.ubercab.UberClient': {
    name: 'Uber (iOS)',
    content: `## Uber Navigation (iOS)
- Home: map centred on your location; "Where to?" bar at bottom
- Tap "Where to?" to enter a destination

## Booking a Ride
- Enter destination → select ride type → confirm pickup → tap Confirm
- Choose payment method before confirming

## During a Ride
- Track driver on map; contact via phone/chat icon
- Share trip: tap Share Status
- Cancel: tap X or ⋮ while waiting`,
  },
};

/**
 * Returns the AppGuide content for the given app ID, or undefined if none found.
 *
 * Resolution order:
 *   1. .appclaw/guides/<appId>.md  (user custom — wins over built-ins)
 *   2. Built-in GUIDES map
 */
export function loadAppGuide(appId: string): string | undefined {
  if (!appId) return undefined;

  // 1. User custom guide
  const customPath = join(process.cwd(), '.appclaw', 'guides', `${appId}.md`);
  if (existsSync(customPath)) {
    const content = readFileSync(customPath, 'utf-8').trim();
    if (content) return `APP_GUIDE (${appId}):\n${content}`;
  }

  // 2. Built-in guide
  const guide = GUIDES[appId];
  if (!guide) return undefined;
  return `APP_GUIDE (${guide.name}):\n${guide.content}`;
}

/** Returns true if an AppGuide exists for the given app ID (built-in or custom). */
export function hasAppGuide(appId: string): boolean {
  if (!appId) return false;
  const customPath = join(process.cwd(), '.appclaw', 'guides', `${appId}.md`);
  return existsSync(customPath) || appId in GUIDES;
}
