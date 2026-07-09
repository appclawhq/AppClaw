/**
 * iOS device model identifier → logical point screen dimensions.
 *
 * Keys are hardware model identifiers returned by appium_mobile_device_info
 * (e.g. "iPhone17,2"). Values are the logical point dimensions that
 * XCUITest W3C Actions expect — NOT physical pixels.
 *
 * Used by window-size.ts to get accurate point dimensions when
 * appium_get_window_rect is unavailable or returns physical pixels.
 */

const rawDeviceMap: Record<string, { Width: string; Height: string; Model: string }> = {
  // ── iPhone SE / Classic ──────────────────────────────────────────────────
  'iPhone8,4': { Width: '320', Height: '568', Model: 'iPhone SE (1st gen)' },
  'iPhone12,8': { Width: '375', Height: '667', Model: 'iPhone SE (2nd gen)' },
  'iPhone14,6': { Width: '375', Height: '667', Model: 'iPhone SE (3rd gen)' },
  'iPhone18,5': { Width: '375', Height: '667', Model: 'iPhone SE (4th gen)' },

  // ── iPhone 5 / 5c / 5s ──────────────────────────────────────────────────
  'iPhone5,1': { Width: '320', Height: '568', Model: 'iPhone 5' },
  'iPhone5,2': { Width: '320', Height: '568', Model: 'iPhone 5' },
  'iPhone5,3': { Width: '320', Height: '568', Model: 'iPhone 5c' },
  'iPhone5,4': { Width: '320', Height: '568', Model: 'iPhone 5c' },
  'iPhone6,1': { Width: '320', Height: '568', Model: 'iPhone 5S' },
  'iPhone6,2': { Width: '320', Height: '568', Model: 'iPhone 5S' },

  // ── iPhone 6 / 6 Plus / 6S / 6S Plus ────────────────────────────────────
  'iPhone7,2': { Width: '375', Height: '667', Model: 'iPhone 6' },
  'iPhone7,1': { Width: '414', Height: '736', Model: 'iPhone 6 Plus' },
  'iPhone8,1': { Width: '375', Height: '667', Model: 'iPhone 6S' },
  'iPhone8,2': { Width: '414', Height: '736', Model: 'iPhone 6S Plus' },

  // ── iPhone 7 / 7 Plus ───────────────────────────────────────────────────
  'iPhone9,1': { Width: '375', Height: '667', Model: 'iPhone 7' },
  'iPhone9,3': { Width: '375', Height: '667', Model: 'iPhone 7' },
  'iPhone9,2': { Width: '414', Height: '736', Model: 'iPhone 7 Plus' },
  'iPhone9,4': { Width: '414', Height: '736', Model: 'iPhone 7 Plus' },

  // ── iPhone 8 / 8 Plus / X ───────────────────────────────────────────────
  'iPhone10,1': { Width: '375', Height: '667', Model: 'iPhone 8' },
  'iPhone10,4': { Width: '375', Height: '667', Model: 'iPhone 8' },
  'iPhone10,2': { Width: '414', Height: '736', Model: 'iPhone 8 Plus' },
  'iPhone10,5': { Width: '414', Height: '736', Model: 'iPhone 8 Plus' },
  'iPhone10,3': { Width: '375', Height: '812', Model: 'iPhone X' },
  'iPhone10,6': { Width: '375', Height: '812', Model: 'iPhone X' },

  // ── iPhone XR / XS / XS Max ─────────────────────────────────────────────
  'iPhone11,8': { Width: '414', Height: '896', Model: 'iPhone XR' },
  'iPhone11,2': { Width: '375', Height: '812', Model: 'iPhone XS' },
  'iPhone11,4': { Width: '414', Height: '896', Model: 'iPhone XS Max' },
  'iPhone11,6': { Width: '414', Height: '896', Model: 'iPhone XS Max' },

  // ── iPhone 11 series ────────────────────────────────────────────────────
  'iPhone12,1': { Width: '414', Height: '896', Model: 'iPhone 11' },
  'iPhone12,3': { Width: '375', Height: '812', Model: 'iPhone 11 Pro' },
  'iPhone12,5': { Width: '414', Height: '896', Model: 'iPhone 11 Pro Max' },

  // ── iPhone 12 series ────────────────────────────────────────────────────
  'iPhone13,1': { Width: '360', Height: '780', Model: 'iPhone 12 Mini' },
  'iPhone13,2': { Width: '390', Height: '844', Model: 'iPhone 12' },
  'iPhone13,3': { Width: '390', Height: '844', Model: 'iPhone 12 Pro' },
  'iPhone13,4': { Width: '428', Height: '926', Model: 'iPhone 12 Pro Max' },

  // ── iPhone 13 series ────────────────────────────────────────────────────
  'iPhone14,4': { Width: '360', Height: '780', Model: 'iPhone 13 Mini' },
  'iPhone14,5': { Width: '390', Height: '844', Model: 'iPhone 13' },
  'iPhone14,2': { Width: '390', Height: '844', Model: 'iPhone 13 Pro' },
  'iPhone14,3': { Width: '428', Height: '926', Model: 'iPhone 13 Pro Max' },

  // ── iPhone 14 series ────────────────────────────────────────────────────
  'iPhone14,7': { Width: '390', Height: '844', Model: 'iPhone 14' },
  'iPhone14,8': { Width: '428', Height: '926', Model: 'iPhone 14 Plus' },
  'iPhone15,2': { Width: '393', Height: '852', Model: 'iPhone 14 Pro' },
  'iPhone15,3': { Width: '430', Height: '932', Model: 'iPhone 14 Pro Max' },

  // ── iPhone 15 series ────────────────────────────────────────────────────
  'iPhone15,4': { Width: '393', Height: '852', Model: 'iPhone 15' },
  'iPhone15,5': { Width: '430', Height: '932', Model: 'iPhone 15 Plus' },
  'iPhone16,1': { Width: '393', Height: '852', Model: 'iPhone 15 Pro' },
  'iPhone16,2': { Width: '430', Height: '932', Model: 'iPhone 15 Pro Max' },

  // ── iPhone 16 series ────────────────────────────────────────────────────
  'iPhone17,3': { Width: '393', Height: '852', Model: 'iPhone 16' },
  'iPhone17,4': { Width: '430', Height: '932', Model: 'iPhone 16 Plus' },
  'iPhone17,1': { Width: '402', Height: '874', Model: 'iPhone 16 Pro' },
  'iPhone17,2': { Width: '440', Height: '956', Model: 'iPhone 16 Pro Max' },
  'iPhone17,5': { Width: '390', Height: '844', Model: 'iPhone 16e' },

  // ── iPhone 17 series (iOS 26) ────────────────────────────────────────────
  'iPhone18,1': { Width: '402', Height: '874', Model: 'iPhone 17' },
  'iPhone18,2': { Width: '440', Height: '956', Model: 'iPhone 17 Plus' },
  'iPhone18,3': { Width: '402', Height: '874', Model: 'iPhone 17 Pro' },
  'iPhone18,4': { Width: '440', Height: '956', Model: 'iPhone 17 Pro Max' },
  'iPhone18,6': { Width: '393', Height: '852', Model: 'iPhone 17 Air' },

  // ── iPad (classic / standard) ────────────────────────────────────────────
  'iPad6,11': { Width: '768', Height: '1024', Model: 'iPad (5th gen)' },
  'iPad6,12': { Width: '768', Height: '1024', Model: 'iPad (5th gen)' },
  'iPad7,5': { Width: '768', Height: '1024', Model: 'iPad (6th gen)' },
  'iPad7,6': { Width: '768', Height: '1024', Model: 'iPad (6th gen)' },
  'iPad7,11': { Width: '810', Height: '1080', Model: 'iPad (7th gen)' },
  'iPad7,12': { Width: '810', Height: '1080', Model: 'iPad (7th gen)' },
  'iPad11,6': { Width: '810', Height: '1080', Model: 'iPad (8th gen)' },
  'iPad11,7': { Width: '810', Height: '1080', Model: 'iPad (8th gen)' },
  'iPad12,1': { Width: '810', Height: '1080', Model: 'iPad (9th gen)' },
  'iPad12,2': { Width: '810', Height: '1080', Model: 'iPad (9th gen)' },
  'iPad13,18': { Width: '820', Height: '1180', Model: 'iPad (10th gen)' },
  'iPad13,19': { Width: '820', Height: '1180', Model: 'iPad (10th gen)' },
  'iPad17,1': { Width: '820', Height: '1180', Model: 'iPad (11th gen)' },
  'iPad17,2': { Width: '820', Height: '1180', Model: 'iPad (11th gen)' },

  // ── iPad Air ─────────────────────────────────────────────────────────────
  'iPad4,1': { Width: '768', Height: '1024', Model: 'iPad Air' },
  'iPad4,2': { Width: '768', Height: '1024', Model: 'iPad Air' },
  'iPad4,3': { Width: '768', Height: '1024', Model: 'iPad Air' },
  'iPad5,3': { Width: '768', Height: '1024', Model: 'iPad Air 2' },
  'iPad5,4': { Width: '768', Height: '1024', Model: 'iPad Air 2' },
  'iPad11,3': { Width: '834', Height: '1112', Model: 'iPad Air 3' },
  'iPad11,4': { Width: '834', Height: '1112', Model: 'iPad Air 3' },
  'iPad13,1': { Width: '820', Height: '1180', Model: 'iPad Air 4' },
  'iPad13,2': { Width: '820', Height: '1180', Model: 'iPad Air 4' },
  'iPad13,16': { Width: '820', Height: '1180', Model: 'iPad Air 5' },
  'iPad13,17': { Width: '820', Height: '1180', Model: 'iPad Air 5' },
  'iPad14,8': { Width: '834', Height: '1194', Model: 'iPad Air 11-inch (M2)' },
  'iPad14,9': { Width: '834', Height: '1194', Model: 'iPad Air 11-inch (M2)' },
  'iPad14,10': { Width: '820', Height: '1180', Model: 'iPad Air 13-inch (M2)' },
  'iPad14,11': { Width: '820', Height: '1180', Model: 'iPad Air 13-inch (M2)' },
  'iPad17,5': { Width: '834', Height: '1194', Model: 'iPad Air 11-inch (M3)' },
  'iPad17,6': { Width: '834', Height: '1194', Model: 'iPad Air 11-inch (M3)' },

  // ── iPad Mini ────────────────────────────────────────────────────────────
  'iPad4,4': { Width: '768', Height: '1024', Model: 'iPad Mini 2' },
  'iPad4,5': { Width: '768', Height: '1024', Model: 'iPad Mini 2' },
  'iPad4,6': { Width: '768', Height: '1024', Model: 'iPad Mini 2' },
  'iPad4,7': { Width: '768', Height: '1024', Model: 'iPad Mini 3' },
  'iPad4,8': { Width: '768', Height: '1024', Model: 'iPad Mini 3' },
  'iPad4,9': { Width: '768', Height: '1024', Model: 'iPad Mini 3' },
  'iPad5,1': { Width: '768', Height: '1024', Model: 'iPad Mini 4' },
  'iPad5,2': { Width: '768', Height: '1024', Model: 'iPad Mini 4' },
  'iPad11,1': { Width: '768', Height: '1024', Model: 'iPad Mini 5' },
  'iPad11,2': { Width: '768', Height: '1024', Model: 'iPad Mini 5' },
  'iPad14,1': { Width: '744', Height: '1133', Model: 'iPad Mini 6' },
  'iPad14,2': { Width: '744', Height: '1133', Model: 'iPad Mini 6' },
  'iPad16,1': { Width: '744', Height: '1133', Model: 'iPad Mini 7 (A17 Pro)' },
  'iPad16,2': { Width: '744', Height: '1133', Model: 'iPad Mini 7 (A17 Pro)' },
  'iPad17,3': { Width: '744', Height: '1133', Model: 'iPad Mini 8' },
  'iPad17,4': { Width: '744', Height: '1133', Model: 'iPad Mini 8' },

  // ── iPad Pro (9.7 / 10.5) ────────────────────────────────────────────────
  'iPad6,3': { Width: '768', Height: '1024', Model: 'iPad Pro (9.7)' },
  'iPad6,4': { Width: '768', Height: '1024', Model: 'iPad Pro (9.7)' },
  'iPad7,3': { Width: '834', Height: '1112', Model: 'iPad Pro (10.5)' },
  'iPad7,4': { Width: '834', Height: '1112', Model: 'iPad Pro (10.5)' },

  // ── iPad Pro (11-inch) ────────────────────────────────────────────────────
  'iPad8,1': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (1st gen)' },
  'iPad8,2': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (1st gen)' },
  'iPad8,3': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (1st gen)' },
  'iPad8,4': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (1st gen)' },
  'iPad8,9': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (2nd gen)' },
  'iPad8,10': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (2nd gen)' },
  'iPad13,4': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (3rd gen)' },
  'iPad13,5': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (3rd gen)' },
  'iPad13,6': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (3rd gen)' },
  'iPad13,7': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (3rd gen)' },
  'iPad14,3': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (4th gen)' },
  'iPad14,4': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (4th gen)' },
  'iPad16,3': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (M4)' },
  'iPad16,4': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (M4)' },
  'iPad17,9': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (M5)' },
  'iPad17,10': { Width: '834', Height: '1194', Model: 'iPad Pro 11-inch (M5)' },

  // ── iPad Pro (12.9-inch) ──────────────────────────────────────────────────
  'iPad7,1': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (2nd gen)' },
  'iPad7,2': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (2nd gen)' },
  'iPad8,5': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (3rd gen)' },
  'iPad8,6': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (3rd gen)' },
  'iPad8,7': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (3rd gen)' },
  'iPad8,8': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (3rd gen)' },
  'iPad8,11': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (4th gen)' },
  'iPad8,12': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (4th gen)' },
  'iPad13,8': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (5th gen)' },
  'iPad13,9': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (5th gen)' },
  'iPad13,10': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (5th gen)' },
  'iPad13,11': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (5th gen)' },
  'iPad14,5': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (6th gen)' },
  'iPad14,6': { Width: '1024', Height: '1366', Model: 'iPad Pro 12.9-inch (6th gen)' },

  // ── iPad Pro (13-inch, M4+) ───────────────────────────────────────────────
  'iPad16,5': { Width: '1032', Height: '1376', Model: 'iPad Pro 13-inch (M4)' },
  'iPad16,6': { Width: '1032', Height: '1376', Model: 'iPad Pro 13-inch (M4)' },
  'iPad17,7': { Width: '1032', Height: '1376', Model: 'iPad Pro 13-inch (M5)' },
  'iPad17,8': { Width: '1032', Height: '1376', Model: 'iPad Pro 13-inch (M5)' },
};

/**
 * Look up the logical point screen dimensions for an iOS device by its
 * hardware model identifier (e.g. "iPhone17,2").
 *
 * Returns null if the model is not in the map (unknown/future device).
 */
export function getIOSScreenSizeFromModel(
  modelId: string
): { width: number; height: number } | null {
  const entry = rawDeviceMap[modelId];
  if (!entry) return null;
  return { width: parseInt(entry.Width, 10), height: parseInt(entry.Height, 10) };
}

/**
 * Extract a hardware model identifier (e.g. "iPhone17,2") from
 * the text output of appium_mobile_device_info.
 *
 * Matches patterns like:
 *   "model": "iPhone17,2"
 *   model: iPhone17,2
 *   iPhone17,2  (bare)
 */
export function extractIOSModelFromDeviceInfo(text: string): string | null {
  // JSON key-value (most reliable)
  const jsonMatch = text.match(/"?model"?\s*:\s*"?(i(?:Phone|Pad)[\d,]+)"?/i);
  if (jsonMatch) return jsonMatch[1];

  // Bare model identifier anywhere in the text
  const bareMatch = text.match(/\b(i(?:Phone|Pad)\d+,\d+)\b/);
  if (bareMatch) return bareMatch[1];

  return null;
}
