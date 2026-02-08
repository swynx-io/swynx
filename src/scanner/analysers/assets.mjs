// src/scanner/analysers/assets.mjs
// Full-depth asset analysis: images, fonts, videos, usage detection, cost impact

import { execSync } from 'child_process';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, basename, extname, dirname, relative } from 'path';
import { glob } from 'glob';

// Lazy-load sharp to avoid top-level await
let sharp = null;
let sharpLoaded = false;

async function getSharp() {
  if (!sharpLoaded) {
    sharpLoaded = true;
    try {
      sharp = (await import('sharp')).default;
    } catch (e) {
      // Sharp not available - will fall back to basic analysis
      sharp = null;
    }
  }
  return sharp;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ASSET_EXTENSIONS = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif', '.bmp', '.tiff', '.tif'],
  font: ['.woff', '.woff2', '.ttf', '.otf', '.eot'],
  video: ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
  document: ['.pdf'],
  data: ['.json', '.xml', '.csv']
};

const ASSET_DIRECTORIES = [
  'public',
  'static',
  'assets',
  'images',
  'img',
  'fonts',
  'media',
  'resources',
  'src/assets',
  'src/images',
  'src/static',
  'app/assets',
  'client/assets'
];

// Size thresholds for recommendations
const SIZE_THRESHOLDS = {
  image: {
    large: 100000,      // 100KB - consider optimization
    veryLarge: 500000,  // 500KB - definitely optimize
    huge: 1000000,      // 1MB - critical
  },
  svg: {
    large: 20000,       // 20KB - consider optimization
    veryLarge: 50000,   // 50KB - definitely optimize
  },
  font: {
    large: 100000,      // 100KB per font file
    veryLarge: 200000,  // 200KB - consider subsetting
  },
  video: {
    large: 5000000,     // 5MB
    veryLarge: 20000000 // 20MB
  }
};

// Browser support for formats (as of 2024)
const FORMAT_BROWSER_SUPPORT = {
  webp: '97%',
  avif: '92%',
  jpeg: '100%',
  png: '100%',
  gif: '100%',
  svg: '98%',
  woff2: '97%',
  woff: '98%',
  mp4: '98%',
  webm: '95%'
};

// Cost assumptions
const DEFAULT_COST_CONFIG = {
  monthlyLoads: 10000,
  cacheHitRate: 0.8,
  bandwidthCostPerGB: 0.08,  // CDN cost per GB
  co2PerGB: 0.5              // kg CO2 per GB transferred
};

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

// Performance limits
const MAX_ASSETS_FOR_GIT_HISTORY = 50; // Git history is slow, limit it
const MAX_ASSETS_FOR_FULL_ANALYSIS = 5000; // Skip analysis entirely for huge codebases

/**
 * Comprehensive asset analysis with full depth
 */
export async function analyseAssetsFullDepth(assetAnalysis, jsAnalysis, cssAnalysis, projectPath, config = {}, onProgress = null) {
  // Skip for extremely large codebases
  if (assetAnalysis.length > MAX_ASSETS_FOR_FULL_ANALYSIS) {
    console.error(`[PERF] Skipping deep asset analysis: ${assetAnalysis.length} assets exceeds limit of ${MAX_ASSETS_FOR_FULL_ANALYSIS}`);
    return {
      summary: {
        totalAssets: assetAnalysis.length,
        totalSize: assetAnalysis.reduce((sum, a) => sum + (a.size || a.sizeBytes || 0), 0),
        unusedAssets: 0,
        unusedSize: 0,
        optimisableAssets: 0,
        potentialSavings: 0,
        byType: {},
        skipped: true,
        skipReason: `Too many assets (${assetAnalysis.length})`
      },
      assets: [],
      unusedAssets: [],
      optimisableAssets: [],
      byType: {},
      quickWins: []
    };
  }
  const results = {
    summary: {
      totalAssets: 0,
      totalSize: 0,
      unusedAssets: 0,
      unusedSize: 0,
      optimisableAssets: 0,
      potentialSavings: 0,
      byType: {
        image: { count: 0, size: 0 },
        font: { count: 0, size: 0 },
        video: { count: 0, size: 0 },
        audio: { count: 0, size: 0 },
        document: { count: 0, size: 0 },
        data: { count: 0, size: 0 },
        other: { count: 0, size: 0 }
      }
    },
    assets: [],
    unusedAssets: [],
    optimisableAssets: [],
    byType: {
      image: [],
      font: [],
      video: [],
      audio: [],
      document: [],
      data: [],
      other: []
    },
    quickWins: []
  };

  // Build source file reference index for fast lookup
  const referenceIndex = buildReferenceIndex(jsAnalysis, cssAnalysis);
  const filesSearched = jsAnalysis.length + cssAnalysis.length;

  // Counter for git history lookups (expensive operation)
  let gitHistoryCount = 0;
  const totalAssets = assetAnalysis.length;
  let processedAssets = 0;

  // Process each asset
  for (const asset of assetAnalysis) {
    processedAssets++;
    // Report progress every 100 assets (both to console and dashboard callback)
    if (processedAssets % 100 === 0 || processedAssets === totalAssets) {
      console.error(`[ASSET] Processing ${processedAssets}/${totalAssets} assets...`);
      if (onProgress) {
        onProgress(`Processing asset ${processedAssets}/${totalAssets}`, processedAssets, totalAssets);
        // Yield to event loop so SSE events can be sent
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    const size = asset.size || asset.sizeBytes || 0;
    const filePath = asset.file?.relativePath || asset.file;
    const ext = (asset.ext || extname(filePath)).toLowerCase();
    const type = getAssetType(ext);

    // Base asset info
    const enrichedAsset = {
      file: filePath,
      relativePath: filePath,
      absolutePath: asset.file?.path || (projectPath ? join(projectPath, filePath) : filePath),
      sizeBytes: size,
      sizeFormatted: formatBytes(size),
      type,
      format: {
        current: ext.replace('.', '').toUpperCase(),
        mimeType: getMimeType(ext),
        detected: true
      }
    };

    // Update summary
    results.summary.totalAssets++;
    results.summary.totalSize += size;
    if (results.summary.byType[type]) {
      results.summary.byType[type].count++;
      results.summary.byType[type].size += size;
    }

    // Check usage
    enrichedAsset.usage = await checkAssetUsage(
      enrichedAsset,
      referenceIndex,
      filesSearched,
      projectPath
    );

    // Type-specific analysis
    if (type === 'image') {
      const imageAnalysis = await analyseImage(enrichedAsset, projectPath);
      Object.assign(enrichedAsset, imageAnalysis);
    } else if (type === 'font') {
      const fontAnalysis = analyseFont(enrichedAsset, projectPath);
      Object.assign(enrichedAsset, fontAnalysis);
    } else if (type === 'video') {
      const videoAnalysis = analyseVideo(enrichedAsset, projectPath);
      Object.assign(enrichedAsset, videoAnalysis);
    } else if (ext === '.svg') {
      const svgAnalysis = await analyseSVG(enrichedAsset, projectPath);
      Object.assign(enrichedAsset, svgAnalysis);
    }

    // Git history for unused assets - OFF by default (very slow on large repos)
    // Enable with config.enableGitHistory = true
    if (config.enableGitHistory && !enrichedAsset.usage.isReferenced && projectPath && gitHistoryCount < MAX_ASSETS_FOR_GIT_HISTORY) {
      enrichedAsset.gitHistory = getAssetGitHistory(filePath, projectPath);
      gitHistoryCount++;
    }

    // Cost calculation
    enrichedAsset.costImpact = calculateAssetCost(enrichedAsset, {
      ...DEFAULT_COST_CONFIG,
      ...config.costConfig
    });

    // Build recommendation
    enrichedAsset.recommendation = buildAssetRecommendation(
      enrichedAsset,
      enrichedAsset.usage,
      enrichedAsset.optimisation,
      enrichedAsset.gitHistory
    );

    // Categorise
    results.assets.push(enrichedAsset);
    if (results.byType[type]) {
      results.byType[type].push(enrichedAsset);
    }

    if (!enrichedAsset.usage.isReferenced) {
      results.unusedAssets.push(enrichedAsset);
      results.summary.unusedAssets++;
      results.summary.unusedSize += size;
    }

    if (enrichedAsset.optimisation?.canOptimise) {
      results.optimisableAssets.push(enrichedAsset);
      results.summary.optimisableAssets++;
      results.summary.potentialSavings += enrichedAsset.optimisation.estimatedSavings || 0;
    }
  }

  // Sort by impact
  results.unusedAssets.sort((a, b) => b.sizeBytes - a.sizeBytes);
  results.optimisableAssets.sort((a, b) =>
    (b.optimisation?.estimatedSavings || 0) - (a.optimisation?.estimatedSavings || 0)
  );

  // Build quick wins
  results.quickWins = buildAssetQuickWins(results);

  // Format summary sizes
  results.summary.totalSizeFormatted = formatBytes(results.summary.totalSize);
  results.summary.unusedSizeFormatted = formatBytes(results.summary.unusedSize);
  results.summary.potentialSavingsFormatted = formatBytes(results.summary.potentialSavings);

  return results;
}

// ============================================================================
// REFERENCE TRACKING
// ============================================================================

/**
 * Build an index of all asset references in source files
 */
function buildReferenceIndex(jsAnalysis, cssAnalysis) {
  const index = new Map(); // assetName/path -> array of references

  // Common asset reference patterns
  const patterns = [
    // Import statements
    /import\s+(?:\w+\s*,?\s*)?(?:\{[^}]*\})?\s*from\s+['"]([^'"]+\.(png|jpg|jpeg|gif|svg|webp|ico|avif|woff|woff2|ttf|eot|mp4|webm|mp3|pdf))['"]/gi,
    // Require statements
    /require\s*\(\s*['"]([^'"]+\.(png|jpg|jpeg|gif|svg|webp|ico|avif|woff|woff2|ttf|eot|mp4|webm|mp3|pdf))['"]\s*\)/gi,
    // String literals with asset paths
    /['"`]([^'"`]*\.(png|jpg|jpeg|gif|svg|webp|ico|avif|woff|woff2|ttf|eot|mp4|webm|mp3|wav|ogg|m4a|pdf))['"`]/gi,
    // Dynamic imports
    /import\s*\(\s*['"]([^'"]+\.(png|jpg|jpeg|gif|svg|webp|ico))['"]\s*\)/gi,
  ];

  // CSS patterns
  const cssPatterns = [
    /url\s*\(\s*['"]?([^'")]+\.(png|jpg|jpeg|gif|svg|webp|ico|avif|woff|woff2|ttf|eot))['"]?\s*\)/gi,
    /src\s*:\s*url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
  ];

  // Scan JS/TS files
  for (const file of jsAnalysis) {
    const content = file.content || '';
    const filePath = file.file?.relativePath || file.file;
    const lines = content.split('\n');

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const assetPath = match[1];
        const assetName = basename(assetPath);
        const lineNum = getLineNumber(content, match.index);
        const lineContent = lines[lineNum - 1] || '';

        // Determine reference type
        let type = 'string-literal';
        if (lineContent.includes('import ')) type = 'import';
        else if (lineContent.includes('require(')) type = 'require';
        else if (lineContent.includes('src=') || lineContent.includes('src:')) type = 'src-attribute';
        else if (lineContent.includes('href=')) type = 'href-attribute';
        else if (lineContent.includes('background')) type = 'background';

        const ref = {
          file: filePath,
          line: lineNum,
          type,
          code: lineContent.trim().substring(0, 120),
          fullPath: assetPath
        };

        // Index by filename and full path
        addToIndex(index, assetName, ref);
        addToIndex(index, assetPath, ref);

        // Also index normalized paths
        const normalized = assetPath.replace(/^[./]+/, '').replace(/^public\//, '');
        addToIndex(index, normalized, ref);
      }
    }
  }

  // Scan CSS files
  for (const file of cssAnalysis) {
    const content = file.content || '';
    const filePath = file.file?.relativePath || file.file;
    const lines = content.split('\n');

    for (const pattern of cssPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const assetPath = match[1];
        if (assetPath.startsWith('data:')) continue; // Skip data URIs

        const assetName = basename(assetPath);
        const lineNum = getLineNumber(content, match.index);
        const lineContent = lines[lineNum - 1] || '';

        let type = 'css-url';
        if (lineContent.includes('background')) type = 'css-background';
        else if (lineContent.includes('font-face') || lineContent.includes('src:')) type = 'css-font';

        const ref = {
          file: filePath,
          line: lineNum,
          type,
          code: lineContent.trim().substring(0, 120),
          fullPath: assetPath
        };

        addToIndex(index, assetName, ref);
        addToIndex(index, assetPath, ref);

        const normalized = assetPath.replace(/^[./]+/, '').replace(/^public\//, '');
        addToIndex(index, normalized, ref);
      }
    }
  }

  return index;
}

function addToIndex(index, key, ref) {
  if (!index.has(key)) {
    index.set(key, []);
  }
  // Avoid duplicate references
  const existing = index.get(key);
  const isDuplicate = existing.some(r =>
    r.file === ref.file && r.line === ref.line
  );
  if (!isDuplicate) {
    existing.push(ref);
  }
}

/**
 * Check if an asset is used anywhere
 */
async function checkAssetUsage(asset, referenceIndex, filesSearched, projectPath) {
  const filename = basename(asset.file);
  const filenameNoExt = basename(asset.file, extname(asset.file));
  const relativePath = asset.relativePath;

  // Patterns to check
  const searchPatterns = [
    filename,
    filenameNoExt,
    relativePath,
    relativePath.replace(/\\/g, '/'),
    relativePath.replace(/^public\//, '/'),
    relativePath.replace(/^public\//, ''),
    relativePath.replace(/^src\//, ''),
    '/' + filename
  ];

  // Collect all references
  const allReferences = [];
  const seenRefs = new Set();

  for (const pattern of searchPatterns) {
    const refs = referenceIndex.get(pattern) || [];
    for (const ref of refs) {
      const key = `${ref.file}:${ref.line}`;
      if (!seenRefs.has(key)) {
        seenRefs.add(key);
        allReferences.push(ref);
      }
    }
  }

  // Also check for partial matches (e.g., '/images/hero.png' matches 'public/images/hero.png')
  for (const [key, refs] of referenceIndex.entries()) {
    if (relativePath.endsWith(key) || key.endsWith(filename)) {
      for (const ref of refs) {
        const refKey = `${ref.file}:${ref.line}`;
        if (!seenRefs.has(refKey)) {
          seenRefs.add(refKey);
          allReferences.push(ref);
        }
      }
    }
  }

  return {
    isReferenced: allReferences.length > 0,
    references: allReferences.slice(0, 20), // Limit to 20 references
    referenceCount: allReferences.length,
    filesSearched,
    searchPatterns: [...new Set(searchPatterns)]
  };
}

// ============================================================================
// IMAGE ANALYSIS
// ============================================================================

/**
 * Deep image analysis using sharp
 */
async function analyseImage(asset, projectPath) {
  const result = {
    dimensions: null,
    analysis: null,
    optimisation: null
  };

  const fullPath = asset.absolutePath || (projectPath ? join(projectPath, asset.file) : null);
  if (!fullPath || !existsSync(fullPath)) {
    return result;
  }

  const ext = extname(asset.file).toLowerCase();
  const size = asset.sizeBytes;

  // Try sharp first for comprehensive analysis
  const sharpModule = await getSharp();
  if (sharpModule) {
    try {
      const metadata = await sharpModule(fullPath).metadata();

      result.dimensions = {
        width: metadata.width,
        height: metadata.height,
        aspectRatio: getAspectRatio(metadata.width, metadata.height),
        megapixels: parseFloat(((metadata.width * metadata.height) / 1000000).toFixed(2))
      };

      result.analysis = {
        hasAlpha: metadata.hasAlpha || false,
        isAnimated: (metadata.pages || 1) > 1,
        colorDepth: metadata.depth || 8,
        colorSpace: metadata.space || 'unknown',
        colorProfile: metadata.icc ? 'embedded' : 'none',
        isPhotographic: isPhotographic(metadata, size),
        channels: metadata.channels,
        density: metadata.density
      };

      result.optimisation = getImageOptimisation(asset, metadata, result.analysis, projectPath);

    } catch (err) {
      // Sharp failed, try fallback
      result.dimensions = getImageDimensionsFallback(asset.file, projectPath);
      result.optimisation = getBasicImageOptimisation(asset, result.dimensions, projectPath);
    }
  } else {
    // No sharp available, use fallback
    result.dimensions = getImageDimensionsFallback(asset.file, projectPath);
    result.optimisation = getBasicImageOptimisation(asset, result.dimensions, projectPath);
  }

  return result;
}

/**
 * Get optimisation recommendations for an image
 */
function getImageOptimisation(asset, metadata, analysis, projectPath) {
  const format = (metadata.format || '').toLowerCase();
  const hasAlpha = analysis.hasAlpha;
  const isPhoto = analysis.isPhotographic;
  const size = asset.sizeBytes;
  const isAnimated = analysis.isAnimated;

  let recommendedFormat = format;
  let reason = '';
  let estimatedSavingsPercent = 0;
  let qualitySetting = isPhoto ? 80 : 90;

  // PNG with no alpha → WebP or JPEG
  if (format === 'png' && !hasAlpha) {
    recommendedFormat = 'webp';
    reason = 'PNG with no transparency. WebP provides 85-95% compression for photographic images with no visible quality loss.';
    estimatedSavingsPercent = isPhoto ? 0.92 : 0.70;
  }
  // PNG with alpha → WebP (keeps alpha)
  else if (format === 'png' && hasAlpha) {
    recommendedFormat = 'webp';
    reason = 'PNG with transparency. WebP supports alpha channel and is typically 70-80% smaller.';
    estimatedSavingsPercent = 0.75;
  }
  // JPEG → WebP
  else if (format === 'jpeg' || format === 'jpg') {
    recommendedFormat = 'webp';
    reason = 'JPEG can be converted to WebP for 25-35% additional compression with equivalent quality.';
    estimatedSavingsPercent = 0.30;
  }
  // GIF
  else if (format === 'gif') {
    if (!isAnimated) {
      recommendedFormat = 'webp';
      reason = 'Static GIF. WebP or PNG would be significantly smaller.';
      estimatedSavingsPercent = 0.60;
    } else {
      recommendedFormat = 'webp';
      reason = 'Animated GIF. WebP animation or MP4 for video-like content provides much better compression.';
      estimatedSavingsPercent = 0.50;
    }
  }
  // BMP/TIFF → definitely convert
  else if (format === 'bmp' || format === 'tiff' || format === 'tif') {
    recommendedFormat = 'webp';
    reason = `${format.toUpperCase()} is uncompressed/lossless. Convert to WebP for 90%+ savings.`;
    estimatedSavingsPercent = 0.95;
  }
  // Already WebP → check if AVIF could help
  else if (format === 'webp') {
    if (size > 500000) {
      recommendedFormat = 'avif';
      reason = 'Already WebP. AVIF could provide additional 20-30% savings for large images.';
      estimatedSavingsPercent = 0.25;
    } else {
      return {
        canOptimise: false,
        currentFormat: 'WEBP',
        reason: 'Already using WebP format. Well optimised.'
      };
    }
  }
  // AVIF - already optimal
  else if (format === 'avif') {
    return {
      canOptimise: false,
      currentFormat: 'AVIF',
      reason: 'Already using AVIF - the most efficient image format available.'
    };
  }

  // Only suggest if >10% savings
  if (estimatedSavingsPercent < 0.10) {
    return {
      canOptimise: false,
      currentFormat: format.toUpperCase(),
      reason: 'Image is already reasonably optimised.'
    };
  }

  const estimatedOptimisedSize = Math.round(size * (1 - estimatedSavingsPercent));
  const estimatedSavings = size - estimatedOptimisedSize;

  return {
    canOptimise: true,
    currentFormat: format.toUpperCase(),
    recommendedFormat: recommendedFormat.toUpperCase(),
    reason,
    estimatedOptimisedSize,
    estimatedSavings,
    savingsPercent: Math.round(estimatedSavingsPercent * 100),
    qualitySetting,
    alternativeFormats: getAlternativeFormats(format, size, hasAlpha, isAnimated),
    additionalSuggestions: getAdditionalSuggestions(asset, metadata)
  };
}

/**
 * Basic optimisation analysis when sharp is not available
 */
function getBasicImageOptimisation(asset, dimensions, projectPath) {
  const ext = extname(asset.file).toLowerCase().replace('.', '');
  const size = asset.sizeBytes;

  const FORMAT_ESTIMATES = {
    'png': { optimal: 'webp', savingsPercent: 0.75, reason: 'WebP provides better compression for PNG images' },
    'jpg': { optimal: 'webp', savingsPercent: 0.30, reason: 'WebP provides 25-35% smaller files than JPEG' },
    'jpeg': { optimal: 'webp', savingsPercent: 0.30, reason: 'WebP provides 25-35% smaller files than JPEG' },
    'gif': { optimal: 'webp', savingsPercent: 0.50, reason: 'WebP supports animation with better compression' },
    'bmp': { optimal: 'webp', savingsPercent: 0.95, reason: 'BMP is uncompressed, WebP is highly efficient' },
    'tiff': { optimal: 'webp', savingsPercent: 0.90, reason: 'TIFF is for editing, WebP is for web delivery' },
    'tif': { optimal: 'webp', savingsPercent: 0.90, reason: 'TIFF is for editing, WebP is for web delivery' }
  };

  const estimate = FORMAT_ESTIMATES[ext];
  if (!estimate) {
    return { canOptimise: false, currentFormat: ext.toUpperCase() };
  }

  const estimatedOptimisedSize = Math.round(size * (1 - estimate.savingsPercent));

  return {
    canOptimise: true,
    currentFormat: ext.toUpperCase(),
    recommendedFormat: estimate.optimal.toUpperCase(),
    reason: estimate.reason,
    estimatedOptimisedSize,
    estimatedSavings: size - estimatedOptimisedSize,
    savingsPercent: Math.round(estimate.savingsPercent * 100),
    qualitySetting: 80,
    alternativeFormats: getAlternativeFormats(ext, size, false, false),
    note: 'Install sharp package for more accurate analysis'
  };
}

/**
 * Get alternative format suggestions
 */
function getAlternativeFormats(currentFormat, size, hasAlpha, isAnimated) {
  const alternatives = [];

  if (currentFormat !== 'webp') {
    alternatives.push({
      format: 'WebP',
      estimatedSize: Math.round(size * 0.15),
      savings: '85%',
      support: FORMAT_BROWSER_SUPPORT.webp,
      supportsAlpha: true,
      supportsAnimation: true
    });
  }

  if (currentFormat !== 'avif' && size > 100000) {
    alternatives.push({
      format: 'AVIF',
      estimatedSize: Math.round(size * 0.10),
      savings: '90%',
      support: FORMAT_BROWSER_SUPPORT.avif,
      supportsAlpha: true,
      supportsAnimation: true
    });
  }

  if (!hasAlpha && currentFormat === 'png') {
    alternatives.push({
      format: 'JPEG',
      estimatedSize: Math.round(size * 0.15),
      savings: '85%',
      support: FORMAT_BROWSER_SUPPORT.jpeg,
      supportsAlpha: false,
      supportsAnimation: false
    });
  }

  return alternatives;
}

/**
 * Get additional suggestions for image optimisation
 */
function getAdditionalSuggestions(asset, metadata) {
  const suggestions = [];

  if (metadata) {
    // Large dimensions
    if (metadata.width > 1920 || metadata.height > 1080) {
      suggestions.push(`Image is ${metadata.width}x${metadata.height}. Consider if you need this resolution - most displays are 1920x1080 or smaller.`);
    }

    // Very large dimensions
    if (metadata.width > 3840 || metadata.height > 2160) {
      suggestions.push(`Image is 4K+ resolution (${metadata.width}x${metadata.height}). This is rarely needed for web - consider downscaling.`);
    }
  }

  // Very large file
  if (asset.sizeBytes > 1000000) {
    suggestions.push('Consider lazy loading this image if below the fold.');
  }

  // Could use responsive images
  if (metadata && metadata.width > 800) {
    suggestions.push('Consider responsive images (srcset) to serve different sizes for different screen sizes.');
  }

  return suggestions;
}

/**
 * Determine if an image is photographic (vs graphic/illustration)
 */
function isPhotographic(metadata, size) {
  // Heuristic: high color depth + large dimensions + JPEG/PNG format + large size = likely photo
  return (
    metadata.depth >= 8 &&
    metadata.width > 400 &&
    metadata.height > 400 &&
    (metadata.format === 'jpeg' || metadata.format === 'png') &&
    size > 50000
  );
}

// ============================================================================
// SVG ANALYSIS
// ============================================================================

/**
 * Analyse SVG for optimisation
 */
async function analyseSVG(asset, projectPath) {
  const result = {
    analysis: null,
    optimisation: null
  };

  const fullPath = asset.absolutePath || (projectPath ? join(projectPath, asset.file) : null);
  if (!fullPath || !existsSync(fullPath)) {
    return result;
  }

  const size = asset.sizeBytes;

  try {
    const content = readFileSync(fullPath, 'utf-8');

    result.analysis = {
      hasMetadata: content.includes('<metadata') || content.includes('<!-- Generator') || content.includes('xmlns:sodipodi'),
      hasComments: (content.match(/<!--[\s\S]*?-->/g) || []).length,
      hasInlineStyles: content.includes('style="'),
      hasEmbeddedImages: content.includes('data:image'),
      estimatedPaths: (content.match(/<path/gi) || []).length,
      estimatedElements: (content.match(/<[a-z]/gi) || []).length,
      hasFilters: content.includes('<filter'),
      hasGradients: content.includes('<linearGradient') || content.includes('<radialGradient')
    };

    // Get dimensions from viewBox or width/height
    const viewBoxMatch = content.match(/viewBox=["']([^"']+)["']/);
    const widthMatch = content.match(/width=["'](\d+)/);
    const heightMatch = content.match(/height=["'](\d+)/);

    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/\s+/);
      if (parts.length === 4) {
        result.dimensions = {
          width: parseFloat(parts[2]),
          height: parseFloat(parts[3]),
          aspectRatio: getAspectRatio(parseFloat(parts[2]), parseFloat(parts[3]))
        };
      }
    } else if (widthMatch && heightMatch) {
      result.dimensions = {
        width: parseInt(widthMatch[1]),
        height: parseInt(heightMatch[1]),
        aspectRatio: getAspectRatio(parseInt(widthMatch[1]), parseInt(heightMatch[1]))
      };
    }

    // Estimate savings
    let estimatedSavingsPercent = 0.35; // SVGO typically saves 30-40%
    const reasons = ['Run through SVGO to remove unnecessary metadata and minify'];

    if (result.analysis.hasMetadata) {
      estimatedSavingsPercent += 0.1;
      reasons.push('Contains editor metadata that can be stripped');
    }
    if (result.analysis.hasComments > 2) {
      estimatedSavingsPercent += 0.05;
      reasons.push(`Contains ${result.analysis.hasComments} comments that can be removed`);
    }
    if (result.analysis.hasEmbeddedImages) {
      reasons.push('Contains embedded images - consider extracting to separate files');
    }

    const canOptimise = size >= SIZE_THRESHOLDS.svg.large || estimatedSavingsPercent > 0.3;

    result.optimisation = {
      canOptimise,
      currentFormat: 'SVG',
      recommendedFormat: 'SVG (optimised)',
      reason: reasons.join('. '),
      estimatedOptimisedSize: Math.round(size * (1 - Math.min(estimatedSavingsPercent, 0.6))),
      estimatedSavings: Math.round(size * Math.min(estimatedSavingsPercent, 0.6)),
      savingsPercent: Math.round(Math.min(estimatedSavingsPercent, 0.6) * 100),
      svgAnalysis: result.analysis
    };

    // Priority based on size
    if (size >= SIZE_THRESHOLDS.svg.veryLarge) {
      result.optimisation.priority = 'high';
    } else if (size >= SIZE_THRESHOLDS.svg.large) {
      result.optimisation.priority = 'medium';
    } else {
      result.optimisation.priority = 'low';
    }

  } catch (err) {
    result.analysis = { error: err.message };
  }

  return result;
}

// ============================================================================
// FONT ANALYSIS
// ============================================================================

/**
 * Analyse font for optimisation
 */
function analyseFont(asset, projectPath) {
  const result = {
    analysis: null,
    optimisation: null
  };

  const ext = extname(asset.file).toLowerCase();
  const size = asset.sizeBytes;

  result.analysis = {
    format: ext.replace('.', ''),
    isModern: ext === '.woff2',
    isLegacy: ext === '.eot' || ext === '.ttf' || ext === '.otf'
  };

  let recommendedFormat = null;
  let reason = '';
  let estimatedSavingsPercent = 0;
  const additionalSuggestions = [];

  // Format recommendations
  if (ext === '.ttf' || ext === '.otf') {
    recommendedFormat = 'woff2';
    reason = 'TTF/OTF fonts should be converted to WOFF2 for web delivery - WOFF2 is typically 30-70% smaller.';
    estimatedSavingsPercent = 0.50;
  } else if (ext === '.woff') {
    recommendedFormat = 'woff2';
    reason = 'WOFF can be converted to WOFF2 for an additional 25-30% size reduction.';
    estimatedSavingsPercent = 0.30;
  } else if (ext === '.eot') {
    recommendedFormat = 'woff2';
    reason = 'EOT is only needed for IE8 and below. Remove and use WOFF2 instead.';
    estimatedSavingsPercent = 0.70;
    additionalSuggestions.push('EOT format is obsolete - consider removing entirely');
  } else if (ext === '.woff2') {
    // WOFF2 is already the optimal web font format - nothing to convert to
    result.optimisation = {
      canOptimise: false,
      currentFormat: 'WOFF2',
      reason: 'Already using WOFF2 - the most efficient web font format.'
    };
    return result;
  }

  // Subsetting recommendation for large fonts
  if (size > SIZE_THRESHOLDS.font.veryLarge && !additionalSuggestions.some(s => s.includes('subset'))) {
    additionalSuggestions.push('Large font file - consider subsetting to used characters only. A 500KB font using 3 characters is wasting 499KB.');
  }

  const canOptimise = estimatedSavingsPercent > 0.1 || size > SIZE_THRESHOLDS.font.large;

  result.optimisation = {
    canOptimise,
    currentFormat: ext.replace('.', '').toUpperCase(),
    recommendedFormat: recommendedFormat ? recommendedFormat.toUpperCase() : null,
    reason,
    estimatedOptimisedSize: Math.round(size * (1 - estimatedSavingsPercent)),
    estimatedSavings: Math.round(size * estimatedSavingsPercent),
    savingsPercent: Math.round(estimatedSavingsPercent * 100),
    additionalSuggestions,
    priority: size >= SIZE_THRESHOLDS.font.veryLarge ? 'high' : 'medium'
  };

  return result;
}

// ============================================================================
// VIDEO ANALYSIS
// ============================================================================

/**
 * Analyse video for optimisation
 */
function analyseVideo(asset, projectPath) {
  const result = {
    analysis: null,
    optimisation: null
  };

  const ext = extname(asset.file).toLowerCase();
  const size = asset.sizeBytes;

  result.analysis = {
    format: ext.replace('.', ''),
    isModern: ext === '.webm' || ext === '.mp4',
    isLegacy: ext === '.avi' || ext === '.mov' || ext === '.mkv'
  };

  let recommendedFormat = null;
  let reason = '';
  let estimatedSavingsPercent = 0;
  const additionalSuggestions = [];

  // Format recommendations
  if (ext === '.mov' || ext === '.avi' || ext === '.mkv') {
    recommendedFormat = 'mp4';
    reason = `${ext.toUpperCase().replace('.', '')} is not optimised for web. Convert to MP4 (H.264) or WebM (VP9) for better compression and compatibility.`;
    estimatedSavingsPercent = 0.50;
  } else if (ext === '.mp4' && size > SIZE_THRESHOLDS.video.veryLarge) {
    additionalSuggestions.push('Consider reducing resolution or bitrate for web delivery');
    additionalSuggestions.push('Consider WebM format for additional compression (VP9 codec)');
  }

  // Large video suggestions
  if (size > SIZE_THRESHOLDS.video.large) {
    additionalSuggestions.push('Consider lazy loading or video-on-demand instead of embedding');
    additionalSuggestions.push('Consider using a video hosting service (YouTube, Vimeo) for large videos');
  }

  const canOptimise = estimatedSavingsPercent > 0.1 || ext !== '.mp4' && ext !== '.webm';

  result.optimisation = {
    canOptimise,
    currentFormat: ext.replace('.', '').toUpperCase(),
    recommendedFormat: recommendedFormat ? recommendedFormat.toUpperCase() : null,
    reason,
    estimatedOptimisedSize: estimatedSavingsPercent > 0 ? Math.round(size * (1 - estimatedSavingsPercent)) : null,
    estimatedSavings: estimatedSavingsPercent > 0 ? Math.round(size * estimatedSavingsPercent) : 0,
    savingsPercent: Math.round(estimatedSavingsPercent * 100),
    additionalSuggestions,
    priority: size >= SIZE_THRESHOLDS.video.veryLarge ? 'high' : 'medium'
  };

  return result;
}

// ============================================================================
// COST CALCULATION
// ============================================================================

/**
 * Calculate cost impact for an asset
 */
function calculateAssetCost(asset, config = {}) {
  const {
    monthlyLoads = 10000,
    cacheHitRate = 0.8,
    bandwidthCostPerGB = 0.08,
    co2PerGB = 0.5
  } = config;

  // If unused, no delivery cost
  if (!asset.usage?.isReferenced) {
    return {
      isUnused: true,
      storageCost: 'Negligible',
      note: 'Not served to users, only costs storage and repository bloat'
    };
  }

  const uncachedLoads = monthlyLoads * (1 - cacheHitRate);
  const monthlyBytes = asset.sizeBytes * uncachedLoads;
  const monthlyGB = monthlyBytes / (1024 ** 3);

  const current = {
    monthlyBandwidth: formatBytes(monthlyBytes),
    monthlyBandwidthGB: parseFloat(monthlyGB.toFixed(4)),
    monthlyCost: parseFloat((monthlyGB * bandwidthCostPerGB).toFixed(2)),
    annualCost: parseFloat((monthlyGB * bandwidthCostPerGB * 12).toFixed(2)),
    monthlyCO2Kg: parseFloat((monthlyGB * co2PerGB).toFixed(3)),
    annualCO2Kg: parseFloat((monthlyGB * co2PerGB * 12).toFixed(2))
  };

  const result = {
    assumedMonthlyLoads: monthlyLoads,
    cacheHitRate: cacheHitRate * 100 + '%',
    current: {
      monthlyBandwidth: current.monthlyBandwidth,
      monthlyCost: '£' + current.monthlyCost.toFixed(2),
      annualCost: '£' + current.annualCost.toFixed(2),
      monthlyCO2: current.monthlyCO2Kg.toFixed(2) + ' kg',
      annualCO2: current.annualCO2Kg.toFixed(2) + ' kg'
    }
  };

  // If optimisation is available, calculate savings
  if (asset.optimisation?.canOptimise && asset.optimisation.estimatedOptimisedSize) {
    const optimisedBytes = asset.optimisation.estimatedOptimisedSize;
    const optimisedMonthlyBytes = optimisedBytes * uncachedLoads;
    const optimisedMonthlyGB = optimisedMonthlyBytes / (1024 ** 3);

    const optimised = {
      monthlyBandwidth: formatBytes(optimisedMonthlyBytes),
      monthlyCost: parseFloat((optimisedMonthlyGB * bandwidthCostPerGB).toFixed(2)),
      annualCost: parseFloat((optimisedMonthlyGB * bandwidthCostPerGB * 12).toFixed(2)),
      monthlyCO2Kg: parseFloat((optimisedMonthlyGB * co2PerGB).toFixed(3)),
      annualCO2Kg: parseFloat((optimisedMonthlyGB * co2PerGB * 12).toFixed(2))
    };

    result.optimised = {
      monthlyBandwidth: optimised.monthlyBandwidth,
      monthlyCost: '£' + optimised.monthlyCost.toFixed(2),
      annualCost: '£' + optimised.annualCost.toFixed(2),
      monthlyCO2: optimised.monthlyCO2Kg.toFixed(2) + ' kg',
      annualCO2: optimised.annualCO2Kg.toFixed(2) + ' kg'
    };

    result.potentialSavings = {
      monthly: '£' + (current.monthlyCost - optimised.monthlyCost).toFixed(2),
      annual: '£' + (current.annualCost - optimised.annualCost).toFixed(2),
      co2Monthly: (current.monthlyCO2Kg - optimised.monthlyCO2Kg).toFixed(2) + ' kg',
      co2Annual: (current.annualCO2Kg - optimised.annualCO2Kg).toFixed(2) + ' kg'
    };
  }

  return result;
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

/**
 * Build recommendation for an asset
 */
function buildAssetRecommendation(asset, usage, optimisation, gitHistory) {
  // Unused asset
  if (!usage.isReferenced) {
    return {
      action: 'delete',
      priority: gitHistory?.daysSinceReferenced > 90 ? 'medium' : 'low',
      confidence: usage.filesSearched > 20 ? 'high' : 'medium',
      command: `rm "${asset.relativePath}"`,
      reasoning: buildUnusedReasoning(asset, usage, gitHistory)
    };
  }

  // Can be optimised
  if (optimisation?.canOptimise && optimisation.savingsPercent > 15) {
    const priority =
      optimisation.savingsPercent > 80 ? 'high' :
      optimisation.savingsPercent > 50 ? 'medium' : 'low';

    return {
      action: 'convert',
      priority,
      confidence: 'high',
      command: getConversionCommand(asset, optimisation),
      reasoning: buildOptimisationReasoning(asset, optimisation, usage)
    };
  }

  // Already optimal
  return {
    action: 'none',
    priority: 'none',
    confidence: 'high',
    reasoning: 'Asset is referenced and already well-optimised.'
  };
}

function buildUnusedReasoning(asset, usage, gitHistory) {
  const parts = [];

  parts.push(`Not referenced anywhere in ${usage.filesSearched} source files.`);

  if (gitHistory?.lastModified) {
    parts.push(`Last modified ${gitHistory.daysSinceModified} days ago by ${gitHistory.lastModified.author}.`);
  }

  if (gitHistory?.lastReferenced) {
    parts.push(`Last referenced in code ${gitHistory.daysSinceReferenced} days ago.`);
  } else if (gitHistory?.status !== 'git_error') {
    parts.push('No git history of this asset ever being referenced in code.');
  }

  parts.push('Safe to delete.');

  return parts.join(' ');
}

function buildOptimisationReasoning(asset, optimisation, usage) {
  const parts = [];

  parts.push(
    `This ${asset.sizeFormatted} ${optimisation.currentFormat} could be a ` +
    `${formatBytes(optimisation.estimatedOptimisedSize)} ${optimisation.recommendedFormat}.`
  );

  parts.push(`${optimisation.savingsPercent}% smaller with no visible quality loss.`);

  if (asset.costImpact?.potentialSavings) {
    parts.push(`Saves ${asset.costImpact.potentialSavings.annual} per year and ${asset.costImpact.potentialSavings.co2Annual} CO₂.`);
  }

  if (usage.referenceCount > 0) {
    parts.push(`Update ${usage.referenceCount} reference(s) after conversion.`);
  }

  return parts.join(' ');
}

function getConversionCommand(asset, optimisation) {
  const inputFile = asset.relativePath;
  const outputFile = inputFile.replace(/\.[^.]+$/, '.' + (optimisation.recommendedFormat || 'webp').toLowerCase());

  if (optimisation.recommendedFormat === 'WEBP') {
    return `npx sharp-cli "${inputFile}" -o "${outputFile}" --quality ${optimisation.qualitySetting || 80}`;
  }

  if (optimisation.recommendedFormat === 'AVIF') {
    return `npx sharp-cli "${inputFile}" -o "${outputFile}" --format avif --quality ${optimisation.qualitySetting || 80}`;
  }

  if (optimisation.currentFormat === 'SVG' || optimisation.recommendedFormat === 'SVG (OPTIMISED)') {
    return `npx svgo "${inputFile}" -o "${outputFile}"`;
  }

  if (optimisation.recommendedFormat === 'WOFF2') {
    return `# Convert ${inputFile} to WOFF2 using fonttools or similar`;
  }

  return `# Convert ${inputFile} to ${optimisation.recommendedFormat}`;
}

// ============================================================================
// QUICK WINS
// ============================================================================

/**
 * Build quick wins summary
 */
function buildAssetQuickWins(results) {
  const wins = [];

  // Delete unused assets
  if (results.unusedAssets.length > 0) {
    wins.push({
      type: 'delete-unused',
      title: `Delete ${results.unusedAssets.length} unused asset(s)`,
      savings: formatBytes(results.summary.unusedSize),
      effort: 'low',
      confidence: 'high',
      impact: 'Repository cleanup, reduced clone time',
      files: results.unusedAssets.slice(0, 5).map(a => ({
        file: a.relativePath,
        size: a.sizeFormatted
      })),
      totalFiles: results.unusedAssets.length,
      command: results.unusedAssets.length <= 5
        ? `rm ${results.unusedAssets.map(a => `"${a.relativePath}"`).join(' ')}`
        : `# Delete ${results.unusedAssets.length} files - see list`
    });
  }

  // Optimise images
  const highSavingsAssets = results.optimisableAssets.filter(a =>
    a.optimisation?.savingsPercent > 50
  );

  if (highSavingsAssets.length > 0) {
    const totalHighSavings = highSavingsAssets.reduce((sum, a) =>
      sum + (a.optimisation?.estimatedSavings || 0), 0
    );

    wins.push({
      type: 'optimise-high-impact',
      title: `Optimise ${highSavingsAssets.length} high-impact asset(s)`,
      savings: formatBytes(totalHighSavings),
      effort: 'medium',
      confidence: 'high',
      impact: 'Faster page loads, lower bandwidth costs, reduced CO₂',
      topFiles: highSavingsAssets.slice(0, 5).map(a => ({
        file: a.relativePath,
        currentSize: a.sizeFormatted,
        potentialSize: formatBytes(a.optimisation.estimatedOptimisedSize),
        savings: a.optimisation.savingsPercent + '%',
        recommendation: `Convert to ${a.optimisation.recommendedFormat}`
      })),
      totalFiles: highSavingsAssets.length
    });
  }

  // All optimisable assets
  if (results.optimisableAssets.length > highSavingsAssets.length) {
    const remainingAssets = results.optimisableAssets.filter(a =>
      !highSavingsAssets.includes(a)
    );

    if (remainingAssets.length > 0) {
      const totalRemainingSavings = remainingAssets.reduce((sum, a) =>
        sum + (a.optimisation?.estimatedSavings || 0), 0
      );

      wins.push({
        type: 'optimise-remaining',
        title: `Optimise ${remainingAssets.length} additional asset(s)`,
        savings: formatBytes(totalRemainingSavings),
        effort: 'medium',
        confidence: 'medium',
        impact: 'Incremental improvements'
      });
    }
  }

  return wins;
}

// ============================================================================
// GIT HISTORY
// ============================================================================

/**
 * Get git history for an asset
 */
function getAssetGitHistory(filePath, projectPath) {
  try {
    // Check if in git repo
    try {
      execSync('git rev-parse --git-dir', { cwd: projectPath, encoding: 'utf-8', timeout: 2000, stdio: 'pipe' });
    } catch {
      return { available: false, reason: 'Not a git repository' };
    }

    // When was asset last modified
    let lastModified = null;
    try {
      const lastModifiedRaw = execSync(
        `git log -1 --format='{"hash":"%h","author":"%an <%ae>","date":"%ai","message":"%s"}' -- "${filePath}" 2>/dev/null`,
        { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
      ).trim();

      if (lastModifiedRaw) {
        lastModified = JSON.parse(lastModifiedRaw);
      }
    } catch (e) {
      // Git command failed
    }

    // When was asset last referenced in code
    let lastReferenced = null;
    let lastReferencedFile = null;
    const assetName = basename(filePath);

    try {
      const lastReferencedRaw = execSync(
        `git log -1 --format='{"hash":"%h","author":"%an <%ae>","date":"%ai","message":"%s"}' -S "${assetName}" -- "*.js" "*.jsx" "*.ts" "*.tsx" "*.css" "*.scss" "*.html" "*.vue" "*.svelte" 2>/dev/null`,
        { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
      ).trim();

      if (lastReferencedRaw) {
        lastReferenced = JSON.parse(lastReferencedRaw);

        // Try to find which file
        try {
          const filesChanged = execSync(
            `git log -1 --name-only --format="" -S "${assetName}" -- "*.js" "*.jsx" "*.ts" "*.tsx" "*.css" "*.scss" "*.html" 2>/dev/null`,
            { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
          ).trim().split('\n').filter(Boolean);

          if (filesChanged.length > 0) {
            lastReferencedFile = filesChanged[0];
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (e) {
      // Git command failed
    }

    const result = {
      available: true,
      lastModified,
      lastReferenced,
      lastReferencedFile,
      daysSinceModified: null,
      daysSinceReferenced: null
    };

    if (lastModified?.date) {
      result.daysSinceModified = Math.floor(
        (Date.now() - new Date(lastModified.date).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    if (lastReferenced?.date) {
      result.daysSinceReferenced = Math.floor(
        (Date.now() - new Date(lastReferenced.date).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return result;
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function getAssetType(ext) {
  for (const [type, exts] of Object.entries(ASSET_EXTENSIONS)) {
    if (exts.includes(ext)) return type;
  }
  return 'other';
}

function getMimeType(ext) {
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.csv': 'text/csv'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function getAspectRatio(width, height) {
  if (!width || !height) return null;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  const ratioW = width / divisor;
  const ratioH = height / divisor;

  // Simplify common ratios
  if (Math.abs(ratioW / ratioH - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(ratioW / ratioH - 4 / 3) < 0.01) return '4:3';
  if (Math.abs(ratioW / ratioH - 1) < 0.01) return '1:1';
  if (Math.abs(ratioW / ratioH - 21 / 9) < 0.01) return '21:9';

  return `${ratioW}:${ratioH}`;
}

function getLineNumber(content, index) {
  return (content.substring(0, index).match(/\n/g) || []).length + 1;
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function getImageDimensionsFallback(filePath, projectPath) {
  if (!projectPath || !filePath) return null;

  try {
    const fullPath = join(projectPath, filePath);
    if (!existsSync(fullPath)) return null;

    // Try using 'file' command first (most portable)
    const result = execSync(`file "${fullPath}" 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000
    });

    // Parse dimensions from file output
    const match = result.match(/(\d+)\s*x\s*(\d+)/i);
    if (match) {
      return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10),
        aspectRatio: getAspectRatio(parseInt(match[1], 10), parseInt(match[2], 10))
      };
    }

    // Try identify (imagemagick) if available
    try {
      const identifyResult = execSync(`identify -format "%wx%h" "${fullPath}" 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 5000
      });
      const identifyMatch = identifyResult.match(/(\d+)x(\d+)/);
      if (identifyMatch) {
        return {
          width: parseInt(identifyMatch[1], 10),
          height: parseInt(identifyMatch[2], 10),
          aspectRatio: getAspectRatio(parseInt(identifyMatch[1], 10), parseInt(identifyMatch[2], 10))
        };
      }
    } catch (e) {
      // imagemagick not available
    }

    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// BACKWARDS COMPATIBILITY - Old API
// ============================================================================

/**
 * Analyse asset optimization opportunities (backwards compatible)
 */
export function analyseAssetOptimisation(assetAnalysis, projectPath = null) {
  const optimizable = [];
  let potentialSavings = 0;

  for (const asset of assetAnalysis) {
    const size = asset.size || asset.sizeBytes || 0;
    const ext = (asset.ext || extname(asset.file?.relativePath || '')).toLowerCase();
    const filePath = asset.file?.relativePath || asset.file;

    if (size < SIZE_THRESHOLDS.image.large && ext !== '.svg') {
      continue;
    }

    const dimensions = getImageDimensionsFallback(filePath, projectPath);

    // Build basic optimisation info
    const FORMAT_ALTERNATIVES = {
      '.png': { optimal: 'webp', savingsPercent: 75, reason: 'WebP provides better compression' },
      '.jpg': { optimal: 'webp', savingsPercent: 30, reason: 'WebP provides 25-35% smaller files' },
      '.jpeg': { optimal: 'webp', savingsPercent: 30, reason: 'WebP provides 25-35% smaller files' },
      '.gif': { optimal: 'webp', savingsPercent: 50, reason: 'WebP supports animation with smaller sizes' },
      '.bmp': { optimal: 'webp', savingsPercent: 95, reason: 'BMP is uncompressed' },
      '.tiff': { optimal: 'webp', savingsPercent: 90, reason: 'TIFF is for editing, not web' },
      '.svg': { optimal: 'optimized-svg', savingsPercent: 35, reason: 'SVGO can minify SVGs' }
    };

    const formatAlt = FORMAT_ALTERNATIVES[ext];
    if (!formatAlt) continue;

    const savings = Math.floor(size * (formatAlt.savingsPercent / 100));

    let priority = 'low';
    if (size >= SIZE_THRESHOLDS.image.huge) priority = 'critical';
    else if (size >= SIZE_THRESHOLDS.image.veryLarge) priority = 'high';
    else if (size >= SIZE_THRESHOLDS.image.large) priority = 'medium';

    const recommendations = [{
      action: 'convert_format',
      from: ext.replace('.', ''),
      to: formatAlt.optimal,
      reason: formatAlt.reason,
      estimatedSavings: savings,
      command: ext === '.svg'
        ? `npx svgo ${filePath}`
        : `npx sharp-cli ${filePath} -o ${filePath.replace(ext, '.' + formatAlt.optimal)}`
    }];

    if (dimensions && dimensions.width > 2000) {
      recommendations.push({
        action: 'resize',
        reason: `Image is ${dimensions.width}x${dimensions.height} - larger than most displays`,
        suggestedMaxWidth: 1920,
        estimatedSavings: Math.floor(size * 0.5)
      });
    }

    optimizable.push({
      file: filePath,
      type: ext === '.svg' ? 'svg' : 'image',
      format: ext.replace('.', ''),
      currentSize: size,
      currentSizeFormatted: formatBytes(size),
      dimensions,
      potentialSavings: savings,
      potentialSavingsFormatted: formatBytes(savings),
      priority,
      recommendations,
      optimalFormat: formatAlt.optimal
    });

    potentialSavings += savings;
  }

  return {
    optimizable,
    potentialSavings,
    count: optimizable.length,
    summary: {
      totalOptimizable: optimizable.length,
      byPriority: {
        critical: optimizable.filter(o => o.priority === 'critical').length,
        high: optimizable.filter(o => o.priority === 'high').length,
        medium: optimizable.filter(o => o.priority === 'medium').length,
        low: optimizable.filter(o => o.priority === 'low').length
      },
      byType: {
        image: optimizable.filter(o => o.type === 'image').length,
        svg: optimizable.filter(o => o.type === 'svg').length,
        font: optimizable.filter(o => o.type === 'font').length
      }
    }
  };
}

/**
 * Find unused assets (backwards compatible)
 * Note: Git history is DISABLED by default for performance - it's extremely slow on large codebases
 */
export function findUnusedAssets(assetAnalysis, jsAnalysis, cssAnalysis, projectPath = null, options = {}) {
  const referenceIndex = buildReferenceIndex(jsAnalysis, cssAnalysis);
  const filesSearched = jsAnalysis.length + cssAnalysis.length;
  const unusedAssets = [];
  const enableGitHistory = options.enableGitHistory === true; // Off by default

  for (const asset of assetAnalysis) {
    const filePath = asset.file?.relativePath || asset.file;
    const name = asset.name || basename(filePath);
    const size = asset.size || asset.sizeBytes || 0;
    const ext = extname(filePath).toLowerCase();

    const enrichedAsset = {
      file: filePath,
      relativePath: filePath,
      absolutePath: asset.file?.path,
      sizeBytes: size,
      sizeFormatted: formatBytes(size),
      type: getAssetType(ext)
    };

    const usage = {
      isReferenced: false,
      references: [],
      referenceCount: 0,
      filesSearched
    };

    // Check usage
    const filename = basename(filePath);
    const searchPatterns = [
      filename,
      filePath,
      filePath.replace(/\\/g, '/'),
      filePath.replace(/^public\//, '/'),
      filePath.replace(/^public\//, '')
    ];

    for (const pattern of searchPatterns) {
      const refs = referenceIndex.get(pattern) || [];
      if (refs.length > 0) {
        usage.isReferenced = true;
        usage.references.push(...refs);
        usage.referenceCount = refs.length;
        break;
      }
    }

    if (!usage.isReferenced) {
      const dimensions = getImageDimensionsFallback(filePath, projectPath);

      unusedAssets.push({
        file: filePath,
        name,
        size,
        sizeBytes: size,
        sizeFormatted: formatBytes(size),
        type: getAssetType(ext),
        format: ext.replace('.', ''),
        dimensions,
        referencedBy: [],
        referenceCount: 0,
        // Git history disabled by default - too slow on large codebases (5+ seconds per asset)
        gitHistory: enableGitHistory && projectPath ? getAssetGitHistory(filePath, projectPath) : null,
        evidence: {
          filesSearched,
          jsFilesSearched: jsAnalysis.length,
          cssFilesSearched: cssAnalysis.length,
          searchPatterns: ['import statements', 'require calls', 'string literals', 'CSS url()']
        }
      });
    }
  }

  return unusedAssets;
}

/**
 * Enrich an unused asset with deep analysis (backwards compatible)
 */
export function enrichUnusedAsset(asset, projectPath, jsAnalysis, cssAnalysis) {
  const enriched = { ...asset };

  // Ensure dimensions
  if (!enriched.dimensions && projectPath) {
    enriched.dimensions = getImageDimensionsFallback(enriched.file, projectPath);
  }

  // Git history - DISABLED by default due to performance
  // git log -S per asset is extremely slow on large codebases
  // If gitHistory wasn't already set from the main analysis, leave it empty

  // Cost impact
  const monthlyPageViews = 10000;
  const cdnCostPerGB = 0.085;
  const co2PerGB = 0.2;
  const compressedSize = Math.floor(enriched.sizeBytes * 0.8);
  const monthlyTransferGB = (compressedSize * monthlyPageViews) / (1024 * 1024 * 1024);

  enriched.costImpact = {
    assumptions: { monthlyPageViews, cdnCostPerGB, co2PerGB },
    compressedSizeBytes: compressedSize,
    monthlyTransferGB: monthlyTransferGB.toFixed(6),
    monthlyCostGBP: (monthlyTransferGB * cdnCostPerGB).toFixed(4),
    annualCostGBP: (monthlyTransferGB * cdnCostPerGB * 12).toFixed(2),
    monthlyCO2Kg: (monthlyTransferGB * co2PerGB).toFixed(6),
    annualCO2Kg: (monthlyTransferGB * co2PerGB * 12).toFixed(4)
  };

  // Recommendation
  enriched.recommendation = {
    action: 'remove',
    confidence: enriched.evidence?.filesSearched > 20 ? 'high' : 'medium',
    command: `rm "${enriched.file}"`,
    reasoning: buildAssetRemovalReasoning(enriched)
  };

  return enriched;
}

function buildAssetRemovalReasoning(asset) {
  const parts = [];

  parts.push(`Asset "${asset.name}" (${asset.sizeFormatted}) is not referenced in any of the ${asset.evidence?.filesSearched || 'scanned'} files.`);

  if (asset.gitHistory?.lastModified) {
    parts.push(`Last modified ${asset.gitHistory.daysSinceModified} days ago by ${asset.gitHistory.lastModified.author}.`);
  }

  if (asset.gitHistory?.lastReferenced) {
    parts.push(`Last referenced in code ${asset.gitHistory.daysSinceReferenced} days ago.`);
  } else if (asset.gitHistory?.available) {
    parts.push('No git history of this asset ever being referenced in code.');
  }

  if (asset.dimensions) {
    parts.push(`Dimensions: ${asset.dimensions.width}x${asset.dimensions.height}.`);
  }

  return parts.join(' ');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  analyseAssetsFullDepth,
  analyseAssetOptimisation,
  findUnusedAssets,
  enrichUnusedAsset
};
